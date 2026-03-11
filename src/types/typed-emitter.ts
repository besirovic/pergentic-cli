import { EventEmitter } from "node:events";

export class TypedEventEmitter<T> extends EventEmitter {
  emit<K extends string & keyof T>(event: K, ...args: T[K] extends (...a: infer A) => void ? A : never): boolean {
    return super.emit(event, ...args);
  }

  on<K extends string & keyof T>(event: K, listener: T[K] extends (...a: infer A) => void ? (...a: A) => void : never): this {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- EventEmitter.on() accepts (...args: any[]) => void; the typed wrapper guarantees caller-side safety
    return super.on(event, listener);
  }

  once<K extends string & keyof T>(event: K, listener: T[K] extends (...a: infer A) => void ? (...a: A) => void : never): this {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- EventEmitter.once() accepts (...args: any[]) => void; the typed wrapper guarantees caller-side safety
    return super.once(event, listener);
  }

  off<K extends string & keyof T>(event: K, listener: T[K] extends (...a: infer A) => void ? (...a: A) => void : never): this {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- EventEmitter.off() accepts (...args: any[]) => void; the typed wrapper guarantees caller-side safety
    return super.off(event, listener);
  }
}
