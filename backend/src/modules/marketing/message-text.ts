/** Texto do e-mail de aniversário quando a barbearia não escreveu o seu. */
export const DEFAULT_BIRTHDAY_EMAIL_TEXT =
  'Olá, {nome}! Toda a equipe da {barbearia} deseja um feliz aniversário. ' +
  'Esperamos você para comemorar com um visual novo!';

export interface TextValues {
  clientName: string;
  barbershopName: string;
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? '';
}

/** Troca {nome} (primeiro nome do cliente) e {barbearia}. Texto puro: o e-mail não é HTML. */
export function renderText(template: string, values: TextValues): string {
  return template
    .replaceAll('{nome}', firstName(values.clientName))
    .replaceAll('{barbearia}', values.barbershopName);
}

/** Rodapé de todo e-mail de marketing: por que o cliente recebe e como parar (LGPD). */
export function optOutFooter(barbershopName: string): string {
  return (
    `Você recebe esta mensagem porque autorizou o contato da ${barbershopName} por e-mail. ` +
    'Para não receber mais, é só avisar a barbearia.'
  );
}
