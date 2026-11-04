import { HttpStatus } from '@nestjs/common';
import { DomainError } from '../../common/http/domain-error.js';

export const onlinePaymentUnavailable = () =>
  new DomainError(
    'online-payment-unavailable',
    'Service Unavailable',
    'O pagamento online ainda não está disponível. Fale com o suporte do TaNaRegua.',
    HttpStatus.SERVICE_UNAVAILABLE,
  );

export const paymentGatewayUnavailable = () =>
  new DomainError(
    'payment-gateway-unavailable',
    'Bad Gateway',
    'O serviço de pagamento não respondeu. Tente de novo em alguns minutos.',
    HttpStatus.BAD_GATEWAY,
  );
