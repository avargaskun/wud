import type { Apickli } from 'apickli';

export interface ApickliWorld {
    apickli: Apickli;
    attach(data: string): void | Promise<void>;
}
