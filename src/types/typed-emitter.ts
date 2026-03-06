import { EventEmitter } from "node:events";

export class TypedEventEmitter<T> extends EventEmitter {
  emit<K extends string & keyof T>(event: K, ...args: T[K] extends (...a: infer A) => void ? A : never): boolean {
    return super.emit(event, ...args);
  }

  on<K extends string & keyof T>(event: K, listener: T[K] extends (...a: infer A) => void ? (...a: A) => void : never): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  once<K extends string & keyof T>(event: K, listener: T[K] extends (...a: infer A) => void ? (...a: A) => void : never): this {
    return super.once(event, listener as (...args: unknown[]) => void);
  }

  off<K extends string & keyof T>(event: K, listener: T[K] extends (...a: infer A) => void ? (...a: A) => void : never): this {
    return super.off(event, listener as (...args: unknown[]) => void);
  }
}
