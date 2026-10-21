import { useState, type InputHTMLAttributes } from "react";
import { Eye, EyeOff } from "lucide-react";

type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  /** The field's look (the form's `fieldClass`); room is kept on the right for the eye. */
  className?: string;
};

/** A password field with an eye at its end that shows what was typed, and hides it again. */
export const PasswordInput = ({ className = "", disabled, ...rest }: PasswordInputProps) => {
  const [shown, setShown] = useState(false);
  return (
    <span className="relative block">
      <input {...rest} disabled={disabled} type={shown ? "text" : "password"} autoCapitalize="none" autoCorrect="off" spellCheck={false} className={`${className} pr-11`} />
      <button
        type="button"
        className="touch-hit absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-full text-on-surface-variant hover:text-on-surface"
        aria-label={shown ? "Hide password" : "Show password"}
        aria-pressed={shown}
        disabled={disabled}
        // Keeps the field focused (and the keyboard up) while the eye is pressed.
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setShown((on) => !on)}
      >
        {shown ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
      </button>
    </span>
  );
};
