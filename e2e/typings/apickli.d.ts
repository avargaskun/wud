declare module 'apickli' {
    export interface ResponseObject {
        statusCode: number;
        headers: Record<string, string>;
        body: string;
    }

    export type ApickliCallback = (error: Error | null, response: ResponseObject) => void;

    export class Apickli {
        constructor(protocol: string, domain: string);

        addHttpBasicAuthorizationHeader(username: string, password: string): void;

        addRequestHeader(name: string, value: string): void;

        setRequestBody(body: string): void;

        setGlobalVariable(name: string, value: string): void;

        getGlobalVariable(name: string): string;

        evaluatePathInResponseBody(path: string): unknown;

        getResponseObject(): ResponseObject;

        get(resource: string, callback: ApickliCallback): void;

        post(resource: string, callback: ApickliCallback): void;
    }
}

declare module 'apickli/apickli-gherkin';
