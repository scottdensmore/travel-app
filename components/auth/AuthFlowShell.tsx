import Link from 'next/link';
import { ReactNode } from 'react';

export default function AuthFlowShell({
    title,
    description,
    children,
}: {
    title: string;
    description: string;
    children: ReactNode;
}) {
    return (
        <main className="flex min-h-screen items-center justify-center px-4 py-16">
            <section className="grid w-full max-w-md gap-6 rounded-xl border border-zinc-800 bg-zinc-950 p-6 text-white shadow-xl sm:p-8"
                aria-labelledby="auth-flow-title">
                <div className="grid gap-2 text-center">
                    <Link href="/" className="text-sm font-semibold text-zinc-300">Mona Airways</Link>
                    <h1 id="auth-flow-title" className="text-2xl font-semibold tracking-tight">{title}</h1>
                    <p className="text-sm text-zinc-300">{description}</p>
                </div>
                {children}
                <Link href="/login" className="text-center text-sm underline underline-offset-4">
                    Back to sign in
                </Link>
            </section>
        </main>
    );
}
