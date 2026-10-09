-- Run once in the SQL Editor of your NEC Tutor Supabase project.
create extension if not exists vector;
set search_path = public, extensions;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default 'Student', role text not null default 'student' check (role in ('student','admin')),
  department text not null default '', semester text not null default '',
  preferred_style text not null default 'simple', subjects text[] not null default '{}'
);
create or replace function public.create_student_profile() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  insert into profiles(id,name) values(new.id, left(coalesce(new.raw_user_meta_data->>'name','Student'),80)) on conflict do nothing;
  return new;
end $$;
drop trigger if exists nec_student_profile on auth.users;
create trigger nec_student_profile after insert on auth.users for each row execute function public.create_student_profile();
insert into public.profiles(id,name) select id, left(coalesce(raw_user_meta_data->>'name','Student'),80) from auth.users on conflict do nothing;

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path=public as $$
  select exists(select 1 from profiles where id=auth.uid() and role='admin');
$$;
revoke all on function public.is_staff() from public;
grant execute on function public.is_staff() to authenticated;

create table if not exists public.documents (
  id uuid primary key, title text not null, filename text not null, subject text not null,
  unit integer check(unit between 1 and 10), pages integer not null default 0,
  chunk_count integer not null default 0, ocr_pages integer not null default 0,
  status text not null default 'ready' check(status in ('ready','processing','error','needs_ocr')),
  storage_path text not null, uploaded_at timestamptz not null default now()
);
create table if not exists public.document_chunks (
  id bigint generated always as identity primary key,
  document_id uuid not null references public.documents(id) on delete cascade,
  content text not null, page integer not null, embedding vector(768) not null
);
create index if not exists nec_chunk_documents on public.document_chunks(document_id);
create index if not exists nec_vector_index on public.document_chunks using hnsw (embedding vector_cosine_ops);

create table if not exists public.conversations (
  id uuid primary key, user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null, subject text not null, created_at timestamptz not null default now()
);
create table if not exists public.messages (
  id uuid primary key, conversation_id uuid not null references public.conversations(id) on delete cascade,
  role text not null check(role in ('user','assistant')), content text not null,
  sources jsonb not null default '[]', needs_escalation boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists nec_conversation_owner on public.conversations(user_id);
create index if not exists nec_message_conversation on public.messages(conversation_id,created_at);

create table if not exists public.tickets (
  id uuid primary key, user_id uuid not null references public.profiles(id), student_name text not null,
  question text not null, summary text not null, sources jsonb not null default '[]',
  status text not null default 'open' check(status in ('open','in_progress','resolved')),
  created_at timestamptz not null default now()
);
create table if not exists public.ticket_replies (
  id uuid primary key, ticket_id uuid not null references public.tickets(id) on delete cascade,
  author_id uuid not null references public.profiles(id), author text not null,
  content text not null, created_at timestamptz not null default now()
);
create index if not exists nec_ticket_owner on public.tickets(user_id);
create index if not exists nec_reply_ticket on public.ticket_replies(ticket_id);

alter table public.profiles enable row level security;
alter table public.documents enable row level security;
alter table public.document_chunks enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.tickets enable row level security;
alter table public.ticket_replies enable row level security;

drop policy if exists own_profile_read on public.profiles;
create policy own_profile_read on public.profiles for select to authenticated using(id=auth.uid());
drop policy if exists own_profile_update on public.profiles;
create policy own_profile_update on public.profiles for update to authenticated using(id=auth.uid()) with check(id=auth.uid());
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update(name,department,semester,preferred_style,subjects) on public.profiles to authenticated;

drop policy if exists course_document_read on public.documents;
create policy course_document_read on public.documents for select to authenticated using(status='ready' or public.is_staff());
drop policy if exists course_chunk_read on public.document_chunks;
create policy course_chunk_read on public.document_chunks for select to authenticated using(exists(select 1 from documents where id=document_id and status='ready'));
drop policy if exists own_conversations on public.conversations;
create policy own_conversations on public.conversations for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
drop policy if exists own_messages on public.messages;
create policy own_messages on public.messages for all to authenticated
  using(exists(select 1 from conversations where id=conversation_id and user_id=auth.uid()))
  with check(exists(select 1 from conversations where id=conversation_id and user_id=auth.uid()));
drop policy if exists ticket_read on public.tickets;
create policy ticket_read on public.tickets for select to authenticated using(user_id=auth.uid() or public.is_staff());
drop policy if exists ticket_create on public.tickets;
create policy ticket_create on public.tickets for insert to authenticated with check(user_id=auth.uid() and status='open');
drop policy if exists ticket_staff_update on public.tickets;
create policy ticket_staff_update on public.tickets for update to authenticated using(public.is_staff()) with check(public.is_staff());
drop policy if exists reply_read on public.ticket_replies;
create policy reply_read on public.ticket_replies for select to authenticated using(exists(select 1 from tickets where id=ticket_id and (user_id=auth.uid() or public.is_staff())));
drop policy if exists reply_staff_create on public.ticket_replies;
create policy reply_staff_create on public.ticket_replies for insert to authenticated with check(public.is_staff() and author_id=auth.uid());
revoke all on public.documents,public.document_chunks from anon,authenticated;
grant select on public.documents,public.document_chunks to authenticated;
grant select,insert,update,delete on public.conversations,public.messages to authenticated;
grant select,insert,update on public.tickets to authenticated;
grant select,insert on public.ticket_replies to authenticated;

create or replace function public.match_course_chunks(query_embedding vector(768), selected_subject text default null, selected_unit integer default null, match_limit integer default 6)
returns table(id bigint, document_id uuid, content text, page integer, title text, subject text, unit integer, similarity float)
language sql stable security invoker set search_path=public,extensions as $$
 select c.id,c.document_id,c.content,c.page,d.title,d.subject,d.unit,1-(c.embedding <=> query_embedding) as similarity
 from document_chunks c join documents d on d.id=c.document_id
 where d.status='ready' and (selected_subject is null or selected_subject='all' or d.subject=selected_subject)
   and (selected_unit is null or d.unit=selected_unit) and 1-(c.embedding <=> query_embedding)>0.45
 order by c.embedding <=> query_embedding limit least(greatest(match_limit,1),12);
$$;
revoke all on function public.match_course_chunks(vector,text,integer,integer) from public;
grant execute on function public.match_course_chunks(vector,text,integer,integer) to authenticated;

create or replace function public.replace_document_index(document_data jsonb,chunk_data jsonb) returns void
language plpgsql security definer set search_path=public,extensions as $$
declare doc_id uuid := (document_data->>'id')::uuid;
begin
  insert into documents(id,title,filename,subject,unit,pages,chunk_count,ocr_pages,storage_path,status)
  values(doc_id,document_data->>'title',document_data->>'filename',document_data->>'subject',(document_data->>'unit')::integer,
    (document_data->>'pages')::integer,(document_data->>'chunk_count')::integer,(document_data->>'ocr_pages')::integer,document_data->>'storage_path','ready')
  on conflict(id) do update set title=excluded.title,filename=excluded.filename,subject=excluded.subject,unit=excluded.unit,
    pages=excluded.pages,chunk_count=excluded.chunk_count,ocr_pages=excluded.ocr_pages,storage_path=excluded.storage_path,status='ready',uploaded_at=now();
  delete from document_chunks where document_id=doc_id;
  insert into document_chunks(document_id,content,page,embedding)
  select doc_id,item->>'content',(item->>'page')::integer,(item->>'embedding')::vector from jsonb_array_elements(chunk_data) item;
end $$;
revoke all on function public.replace_document_index(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.replace_document_index(jsonb,jsonb) to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('materials','materials',false,26214400,array['application/pdf']) on conflict(id) do nothing;
-- Files are served using short-lived signed URLs after backend authentication.
-- The server secret handles uploads; the bucket stays private.

-- After signing up your staff account, promote it in this SQL Editor:
-- update public.profiles set role='admin' where id=(select id from auth.users where email='YOUR_STAFF_EMAIL');
