import { plainToInstance } from 'class-transformer';
import { ClassConstructor, ClassTransformOptions } from 'class-transformer/types/interfaces';

export function deserialize<T, V>(cls: ClassConstructor<T>, plain: V[], options?: ClassTransformOptions): T[];
export function deserialize<T, V>(cls: ClassConstructor<T>, plain: V, options?: ClassTransformOptions): T;
export function deserialize<T, V>(cls: ClassConstructor<T>, plain: V, options?: ClassTransformOptions): T | T[] {
  return plainToInstance(cls, plain, { excludeExtraneousValues: true, strategy: 'exposeAll', ...options });
}
