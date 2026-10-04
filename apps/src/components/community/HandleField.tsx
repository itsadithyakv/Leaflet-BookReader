import type { Ref } from "react";
import { HANDLE_MAX, cleanHandle } from "./handle";

type HandleFieldProps = {
  /** The bare handle: never with the "@". */
  value: string;
  onChange: (handle: string) => void;
  id?: string;
  /** For a field with no visible label of its own (reader search). */
  ariaLabel?: string;
  describedBy?: string;
  invalid?: boolean;
  disabled?: boolean;
  placeholder?: string;
  inputRef?: Ref<HTMLInputElement>;
  /** Text size and anything else the form's other fields use. */
  className?: string;
  /** Space kept on the left for the "@" (and, in search, the icon before it). */
  indent?: string;
  atClassName?: string;
  /** The gap above, under a label. */
  wrapperClassName?: string;
};

/**
 * A field for a handle, with the "@" drawn in front of what is typed.
 *
 * The "@" is part of the field, not of the value: it is what tells a reader
 * this is the handle and not the name, and it is how the handle is shown
 * everywhere else. It is hidden from screen readers, which hear the field's
 * label ("Handle") instead of "at sign". An "@" typed or pasted is dropped.
 */
export const HandleField = ({
  value,
  onChange,
  id,
  ariaLabel,
  describedBy,
  invalid = false,
  disabled = false,
  placeholder,
  inputRef,
  className = "text-sm",
  indent = "pl-7",
  atClassName = "left-3",
  wrapperClassName = "mt-1"
}: HandleFieldProps) => (
  <span className={`relative block ${wrapperClassName}`}>
    <span aria-hidden className={`pointer-events-none absolute top-1/2 -translate-y-1/2 select-none text-on-surface-variant ${atClassName} ${className}`}>
      @
    </span>
    <input
      id={id}
      ref={inputRef}
      value={value}
      onChange={(event) => onChange(cleanHandle(event.target.value))}
      aria-label={ariaLabel}
      aria-describedby={describedBy}
      aria-invalid={invalid || undefined}
      disabled={disabled}
      placeholder={placeholder}
      autoComplete="off"
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
      // One more than a handle holds, so a pasted "@handle" is not cut short.
      maxLength={HANDLE_MAX + 1}
      className={`inset-field w-full py-2 pr-3 text-on-surface ${indent} ${className}`}
    />
  </span>
);
