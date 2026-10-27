import { AsyncLocalStorage } from 'node:async_hooks';
import { Global, Injectable, Module } from '@nestjs/common';

/**
 * Relógio dos fatos de negócio que entram em relatórios (fechamento e estorno de comanda,
 * lançamentos de caixa e comissão). Injetável para que o seed e os testes gravem histórico
 * com data passada sem mexer no relógio do processo.
 */
@Injectable()
export class Clock {
  private readonly frozen = new AsyncLocalStorage<Date>();

  now(): Date {
    const instant = this.frozen.getStore();
    return instant ? new Date(instant) : new Date();
  }

  /** Executa `fn` com o relógio parado em `instant` (só neste fluxo assíncrono). */
  at<T>(instant: Date, fn: () => Promise<T>): Promise<T> {
    return this.frozen.run(instant, fn);
  }
}

@Global()
@Module({ providers: [Clock], exports: [Clock] })
export class ClockModule {}
