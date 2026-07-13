import { requestPasswordReset } from '@/lib/authAccountFlows';
import { handleAuthEmailRequest } from '@/lib/authEmailRequest';

export async function POST(request: Request) {
    return handleAuthEmailRequest(request, 'reset-request', requestPasswordReset);
}
