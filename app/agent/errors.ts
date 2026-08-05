export interface RemoteTriggerErrorBody {
    error: string;
    containers?: string[];
    details?: { id: string; name: string; reason: string }[];
}

export class RemoteTriggerError extends Error {
    readonly status: number;
    readonly body: RemoteTriggerErrorBody;

    constructor(status: number, body: RemoteTriggerErrorBody) {
        super(body.error);
        this.name = 'RemoteTriggerError';
        this.status = status;
        this.body = body;
    }
}
