import { useId, type ComponentProps, type ReactElement } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

type FieldChromeProps = {
  label: string;
  error?: string;
  hint?: string;
};

/** Label + control + hint/error, wired together with aria attributes for screen readers. */
function FieldChrome({
  label,
  error,
  hint,
  id,
  render,
}: FieldChromeProps & {
  id: string | undefined;
  render: (aria: { id: string; 'aria-invalid'?: true; 'aria-describedby'?: string }) => ReactElement;
}) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const messageId = `${inputId}-message`;

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={inputId}>{label}</Label>
      {render({
        id: inputId,
        ...(error ? { 'aria-invalid': true as const } : {}),
        ...(error || hint ? { 'aria-describedby': messageId } : {}),
      })}
      {error ? (
        <p id={messageId} className="text-sm text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={messageId} className="text-sm text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function FormField({ label, error, hint, id, ...props }: ComponentProps<typeof Input> & FieldChromeProps) {
  return <FieldChrome label={label} error={error} hint={hint} id={id} render={(aria) => <Input {...aria} {...props} />} />;
}

export function TextareaField({
  label,
  error,
  hint,
  id,
  ...props
}: ComponentProps<typeof Textarea> & FieldChromeProps) {
  return (
    <FieldChrome label={label} error={error} hint={hint} id={id} render={(aria) => <Textarea {...aria} {...props} />} />
  );
}

export function SelectField({ label, error, hint, id, ...props }: ComponentProps<typeof Select> & FieldChromeProps) {
  return <FieldChrome label={label} error={error} hint={hint} id={id} render={(aria) => <Select {...aria} {...props} />} />;
}
