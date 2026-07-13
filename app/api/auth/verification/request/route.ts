import { requestEmailVerification } from '@/lib/authAccountFlows';
import { handleAuthEmailRequest } from '@/lib/authEmailRequest';

export async function POST(request: Request) {
    return handleAuthEmailRequest(request, 'verify-request', requestEmailVerification);
}
