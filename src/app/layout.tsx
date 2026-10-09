import type {Metadata} from "next";
import "./globals.css";
export const metadata:Metadata={title:"NEC Tutor | Your academic workspace",description:"Study your course notes, get source-backed explanations and reach college staff."};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>;}
