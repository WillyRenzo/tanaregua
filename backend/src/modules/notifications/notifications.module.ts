import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.js';
import { AppointmentsModule } from '../appointments/appointments.module.js';
import { BarbershopsModule } from '../barbershops/barbershops.module.js';
import { ClientsModule } from '../clients/clients.module.js';
import { LogMailSender, MailSender, ResendMailSender } from './mail-sender.js';
import { OutboxProcessor } from './outbox.processor.js';

@Module({
  imports: [AppointmentsModule, BarbershopsModule, ClientsModule],
  providers: [
    LogMailSender,
    ResendMailSender,
    {
      provide: MailSender,
      inject: [ConfigService, LogMailSender, ResendMailSender],
      useFactory: (config: ConfigService<Env, true>, log: LogMailSender, resend: ResendMailSender) =>
        config.get('MAIL_PROVIDER') === 'resend' ? resend : log,
    },
    OutboxProcessor,
  ],
  exports: [OutboxProcessor, MailSender],
})
export class NotificationsModule {}
