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
