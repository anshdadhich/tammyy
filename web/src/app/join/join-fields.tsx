"use client";

import { useState } from "react";
import { CANONICAL_SKILLS } from "@/lib/skills";

type FieldProps = {
  id: string;
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
};

export function TextField({
  id,
  label,
  required,
  hint,
  error,
  ...input
}: FieldProps & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="field content-start">
      <label className="field-label" htmlFor={id}>
        {label}
        {required && <span className="req" aria-hidden="true">*</span>}
      </label>
      <input
        {...input}
        id={id}
        className="input"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
      />
      {hint && <span className="field-hint">{hint}</span>}
      {error && (
        <p className="field-error" id={`${id}-error`}>
          {error}
        </p>
      )}
    </div>
  );
}

type SelectOption = { value: string; label: string };

export function SelectField({
  id,
  label,
  required,
  hint,
  error,
  options,
  ...select
}: FieldProps & { options: SelectOption[] } & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="field content-start">
      <label className="field-label" htmlFor={id}>
        {label}
        {required && <span className="req" aria-hidden="true">*</span>}
      </label>
      <select
        {...select}
        id={id}
        className="select"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint && <span className="field-hint">{hint}</span>}
      {error && (
        <p className="field-error" id={`${id}-error`}>
          {error}
        </p>
      )}
    </div>
  );
}

export function TextAreaField({
  id,
  label,
  required,
  hint,
  error,
  ...textarea
}: FieldProps & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <div className="field content-start">
      <label className="field-label" htmlFor={id}>
        {label}
        {required && <span className="req" aria-hidden="true">*</span>}
      </label>
      <textarea
        {...textarea}
        id={id}
        className="textarea"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
      />
      {hint && <span className="field-hint">{hint}</span>}
      {error && (
        <p className="field-error" id={`${id}-error`}>
          {error}
        </p>
      )}
    </div>
  );
}

export function CheckField({
  id,
  checked,
  onChange,
  label,
  error,
}: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: React.ReactNode;
  error?: string;
}) {
  return (
    <div className="field content-start">
      <label className="check" htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
        />
        <span>{label}</span>
      </label>
      {error && (
        <p className="field-error" id={`${id}-error`}>
          {error}
        </p>
      )}
    </div>
  );
}

type ChipPickerProps = {
  id: string;
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
};

export function ChipPicker({
  id,
  label,
  required,
  hint,
  error,
  values,
  onChange,
  placeholder,
}: ChipPickerProps) {
  const [query, setQuery] = useState("");
  const trimmed = query.trim();
  const lower = trimmed.toLowerCase();
  const selected = new Set(values.map((value) => value.toLowerCase()));
  const suggestions = CANONICAL_SKILLS.filter(
    (skill) => !lower || skill.toLowerCase().includes(lower),
  ).slice(0, 18);

  function add(raw: string) {
    const value = raw.trim();
    setQuery("");
    if (!value || selected.has(value.toLowerCase()) || values.length >= 50) return;
    onChange([...values, value]);
  }

  function toggle(skill: string) {
    if (selected.has(skill.toLowerCase())) {
      onChange(values.filter((value) => value.toLowerCase() !== skill.toLowerCase()));
    } else {
      add(skill);
    }
  }

  return (
    <div className="field content-start">
      <label className="field-label" htmlFor={id}>
        {label}
        {required && <span className="req" aria-hidden="true">*</span>}
      </label>
      {values.length > 0 && (
        <div className="chips">
          {values.map((value) => (
            <span className="chip" key={value}>
              {value}
              <button
                type="button"
                className="chip-x"
                aria-label={`Remove ${value}`}
                onClick={() => onChange(values.filter((item) => item !== value))}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        id={id}
        className="input"
        value={query}
        maxLength={100}
        placeholder={placeholder ?? "Type to search, Enter to add"}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.stopPropagation();
            add(query);
          }
        }}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
      />
      {suggestions.length > 0 && (
        <div className="chips">
          {suggestions.map((skill) => {
            const on = selected.has(skill.toLowerCase());
            return (
              <button
                type="button"
                key={skill}
                className={`chip-toggle${on ? " is-on" : ""}`}
                aria-pressed={on}
                onClick={() => toggle(skill)}
              >
                {!on && <span aria-hidden="true">+</span>}
                {skill}
              </button>
            );
          })}
        </div>
      )}
      {hint && <span className="field-hint">{hint}</span>}
      {error && (
        <p className="field-error" id={`${id}-error`}>
          {error}
        </p>
      )}
    </div>
  );
}
