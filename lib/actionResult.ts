export interface ActionValidationFailure {
    ok: false;
    error: {
        code: 'VALIDATION_ERROR';
        message: string;
        fields: Record<string, string[]>;
    };
}

export function isActionValidationFailure(value: unknown): value is ActionValidationFailure {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Partial<ActionValidationFailure>;
    return candidate.ok === false && candidate.error?.code === 'VALIDATION_ERROR';
}

export function actionValidationFailure(
    message: string,
    field = '_root'
): ActionValidationFailure {
    return {
        ok: false,
        error: {
            code: 'VALIDATION_ERROR',
            message,
            fields: { [field]: [message] }
        }
    };
}

/**
 * A failure naming more than one field at once.
 *
 * Checking fields one at a time and returning at the first bad one makes a form
 * with two mistakes take two round trips, and leaves the second field looking
 * valid in the meantime. The summary message is what a caller shows when it has
 * nowhere to put a per-field message.
 */
export function actionValidationFailures(
    fieldMessages: Record<string, string>,
    summary?: string,
): ActionValidationFailure {
    const messages = Object.values(fieldMessages);
    return {
        ok: false,
        error: {
            code: 'VALIDATION_ERROR',
            message: summary ?? messages.join(' '),
            fields: Object.fromEntries(
                Object.entries(fieldMessages).map(([field, message]) => [field, [message]]),
            ),
        }
    };
}
