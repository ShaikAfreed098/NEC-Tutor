import { SUBJECTS } from "./types";

const coursePatterns: [string, RegExp][] = [
  ["java", /\bjava\b/i],
  ["algorithms", /\b(data structures?|algorithms?|adsaa)\b/i],
  ["digital-logic", /\b(digital logic|computer organi[sz]ation|dl\s*&?\s*co)\b/i],
  ["human-values", /\b(human values|uhv)\b/i],
  ["chemistry", /\b(chemistry|chem)\b/i],
  ["civil-mechanical", /\b(civil|mechanical)\b/i],
  ["english", /\benglish\b/i],
  ["programming", /\b(c programming|programming in c|introduction to programming|c exam|c examination)\b/i],
];

function isOfficial(question: string) {
  return /\b(deadline|eligible|eligibility|attendance|registration|reschedule|timetable|calendar)\b/i.test(question)
    || (/\b(when|date|dates|time|schedule)\b/i.test(question) && /\b(exam|exams|examination|examinations|internal|semester|college|class|test)\b/i.test(question));
}

export function academicQuery(question: string, selectedSubject: string, unit: number | null, previousQuestion = "") {
  const followsNotice = question.trim().split(/\s+/).length <= 8 && /^(and\b|what about\b|how about\b|when\b)/i.test(question.trim()) && isOfficial(previousQuestion);
  const official = isOfficial(question) || followsNotice;
  const named = coursePatterns.filter(([, pattern]) => pattern.test(question));
  const courseId = named.length === 1 ? named[0][0] : named.length > 1 ? "all" : selectedSubject;
  const selectedCourse = SUBJECTS.find(s => s.id === courseId && s.id !== "academic")?.name || "";
  return { official, subject: official ? "academic" : selectedSubject, unit: official ? null : unit, selectedCourse };
}
