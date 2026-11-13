import { RegisterForm } from './RegisterForm';

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const candidate = typeof query.invite === 'string' ? query.invite : null;
  const invitationToken = candidate && /^[A-Za-z0-9_-]{20,200}$/.test(candidate) ? candidate : null;
  const invitationEmail = typeof query.email === 'string' ? query.email : null;
  return (
    <RegisterForm
      invitationToken={invitationToken}
      invitationEmail={invitationToken ? invitationEmail : null}
    />
  );
}
