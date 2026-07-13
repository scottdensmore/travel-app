"use client";

import * as React from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";

interface UserAuthFormProps extends React.HTMLAttributes<HTMLDivElement> {
    type: "login" | "signup";
}

export default function UserAuthForm({ className, type, ...props }: UserAuthFormProps) {
    const [isLoading, setIsLoading] = React.useState<boolean>(false);
    const [formError, setFormError] = React.useState<{
        message: string;
        fields: Record<string, string[]>;
    } | null>(null);
    const router = useRouter();

    async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setIsLoading(true);
        setFormError(null);
        const formData = new FormData(event.currentTarget);
        const email = String(formData.get('email') ?? '');
        const password = String(formData.get('password') ?? '');
        const name = String(formData.get('name') ?? '');

        if (type === "signup") {
            try {
                const response = await fetch("/api/auth/register", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        name,
                        email,
                        password,
                    }),
                });

                if (!response.ok) {
                    const payload = await response.json().catch(() => null);
                    setFormError({
                        message: payload?.error?.message ?? 'Unable to create your account.',
                        fields: payload?.error?.fields ?? {}
                    });
                    return;
                }

                // Auto sign-in after registration
                const result = await signIn("credentials", {
                    redirect: false,
                    email,
                    password,
                });

                if (result?.error) {
                    console.error(result.error);
                } else {
                    router.push("/");
                    router.refresh();
                }

            } catch (error) {
                console.error(error);
                setFormError({ message: 'Unable to create your account.', fields: {} });
            } finally {
                setIsLoading(false);
            }
        } else {
            // Handle login
            const result = await signIn("credentials", {
                redirect: false,
                email,
                password,
            });

            if (result?.error) {
                console.error(result.error);
            } else {
                router.push("/");
                router.refresh();
            }
            setIsLoading(false);
        }
    }

    return (
        <div className={className} {...props}>
            <form onSubmit={onSubmit}>
                <div className="grid gap-2">
                    {type === "signup" && (
                        <div className="grid gap-1">
                            <label className="sr-only" htmlFor="name">
                                Name
                            </label>
                            <input
                                id="name"
                                name="name"
                                placeholder="John Doe"
                                type="text"
                                autoCapitalize="words"
                                autoComplete="name"
                                autoCorrect="off"
                                disabled={isLoading}
                                aria-invalid={Boolean(formError?.fields.name)}
                                aria-describedby={formError?.fields.name ? 'registration-name-error' : undefined}
                                required
                                style={{
                                    display: "flex",
                                    height: "2.5rem",
                                    width: "100%",
                                    borderRadius: "0.375rem",
                                    border: "1px solid #e4e4e7",
                                    backgroundColor: "transparent",
                                    padding: "0.5rem 0.75rem",
                                    fontSize: "0.875rem",
                                    boxShadow: "0 1px 2px 0 rgba(0, 0, 0, 0.05)",
                                    transition: "color .15s ease-in-out,background-color .15s ease-in-out,border-color .15s ease-in-out,box-shadow .15s ease-in-out",
                                }}
                            />
                            {formError?.fields.name && (
                                <p id="registration-name-error" style={{ color: '#f87171', fontSize: '0.8rem', margin: 0 }}>
                                    {formError.fields.name[0]}
                                </p>
                            )}
                        </div>
                    )}
                    <div className="grid gap-1">
                        <label className="sr-only" htmlFor="email">
                            Email
                        </label>
                        <input
                            id="email"
                            name="email"
                            placeholder="name@example.com"
                            type="email"
                            autoCapitalize="none"
                            autoComplete="email"
                            autoCorrect="off"
                            disabled={isLoading}
                            aria-invalid={Boolean(formError?.fields.email)}
                            aria-describedby={formError?.fields.email ? 'registration-email-error' : undefined}
                            required
                            style={{
                                display: "flex",
                                height: "2.5rem",
                                width: "100%",
                                borderRadius: "0.375rem",
                                border: "1px solid #e4e4e7",
                                backgroundColor: "transparent",
                                padding: "0.5rem 0.75rem",
                                fontSize: "0.875rem",
                                boxShadow: "0 1px 2px 0 rgba(0, 0, 0, 0.05)",
                                transition: "color .15s ease-in-out,background-color .15s ease-in-out,border-color .15s ease-in-out,box-shadow .15s ease-in-out",
                            }}
                        />
                        {formError?.fields.email && (
                            <p id="registration-email-error" style={{ color: '#f87171', fontSize: '0.8rem', margin: 0 }}>
                                {formError.fields.email[0]}
                            </p>
                        )}
                    </div>
                    <div className="grid gap-1">
                        <label className="sr-only" htmlFor="password">
                            Password
                        </label>
                        <input
                            id="password"
                            name="password"
                            placeholder="Password"
                            type="password"
                            autoCapitalize="none"
                            autoComplete="current-password"
                            autoCorrect="off"
                            disabled={isLoading}
                            aria-invalid={Boolean(formError?.fields.password)}
                            aria-describedby={formError?.fields.password ? 'registration-password-error' : undefined}
                            required
                            style={{
                                display: "flex",
                                height: "2.5rem",
                                width: "100%",
                                borderRadius: "0.375rem",
                                border: "1px solid #e4e4e7",
                                backgroundColor: "transparent",
                                padding: "0.5rem 0.75rem",
                                fontSize: "0.875rem",
                                boxShadow: "0 1px 2px 0 rgba(0, 0, 0, 0.05)",
                                transition: "color .15s ease-in-out,background-color .15s ease-in-out,border-color .15s ease-in-out,box-shadow .15s ease-in-out",
                            }}
                        />
                        {formError?.fields.password && (
                            <p id="registration-password-error" style={{ color: '#f87171', fontSize: '0.8rem', margin: 0 }}>
                                {formError.fields.password[0]}
                            </p>
                        )}
                    </div>
                    {formError && (
                        <div role="alert" style={{ color: '#f87171', fontSize: '0.875rem' }}>
                            {formError.message}
                        </div>
                    )}
                    <button disabled={isLoading} style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        whiteSpace: "nowrap",
                        borderRadius: "0.375rem",
                        fontSize: "0.875rem",
                        fontWeight: 500,
                        transition: "colors",
                        backgroundColor: "#18181b",
                        color: "#fafafa",
                        height: "2.5rem",
                        padding: "0.5rem 1rem",
                        marginTop: "0.5rem"
                    }}>
                        {isLoading && (
                            <svg
                                className="mr-2 h-4 w-4 animate-spin"
                                xmlns="http://www.w3.org/2000/svg"
                                fill="none"
                                viewBox="0 0 24 24"
                            >
                                <circle
                                    className="opacity-25"
                                    cx="12"
                                    cy="12"
                                    r="10"
                                    stroke="currentColor"
                                    strokeWidth="4"
                                ></circle>
                                <path
                                    className="opacity-75"
                                    fill="currentColor"
                                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                                ></path>
                            </svg>
                        )}
                        {type === "signup" ? "Create account" : "Sign In with Email"}
                    </button>
                </div>
            </form>
        </div>
    );
}
