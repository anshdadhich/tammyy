"use client";

import { useState, type KeyboardEvent } from "react";
import { CANONICAL_SKILLS, normalizeSkill } from "@/lib/skills";

const DEFAULT_SUGGESTIONS = [
  "Figma",
  "React",
  "TypeScript",
  "Node.js",
  "Go",
  "PostgreSQL",
  "Python",
  "Redis",
];

type Props = {
  skills: string[];
  onChange: (next: string[]) => void;
};

export default function SkillPicker({ skills, onChange }: Props) {
  const [query, setQuery] = useState("");
  const typed = query.trim().toLowerCase();
  const suggestions: string[] = typed
    ? CANONICAL_SKILLS.filter((s) => s.toLowerCase().includes(typed)).slice(0, 12)
    : [...DEFAULT_SUGGESTIONS];

  const find = (name: string): string | undefined =>
    skills.find((s) => s.toLowerCase() === name.toLowerCase());

  const add = (raw: string): void => {
    const normalized = normalizeSkill(raw);
    if (!normalized.trim() || find(normalized)) return;
    onChange([...skills, normalized]);
  };

  const remove = (name: string): void => {
    const existing = find(name);
    if (!existing) return;
    onChange(skills.filter((s) => s !== existing));
  };

  const toggle = (name: string): void => {
    const existing = find(name);
    if (existing) remove(existing);
    else add(name);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    add(query);
    setQuery("");
  };

  return (
    <div>
      <div className="field content-start">
        <label className="field-label" htmlFor="refine-skills">
          Skills &amp; tech stack<span className="req" aria-hidden="true">*</span>
        </label>
        <div className="chips">
          {skills.map((skill) => (
            <span className="chip" key={skill}>
              {skill}
              <button
                type="button"
                className="chip-x"
                aria-label={`Remove ${skill}`}
                onClick={() => remove(skill)}
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
        <div className="relative">
          <input
            id="refine-skills"
            className="input"
            style={{ paddingRight: 38 }}
            role="combobox"
            aria-controls="refine-skills-list"
            aria-expanded={suggestions.length > 0}
            aria-autocomplete="list"
            placeholder="+ Add skill…"
            maxLength={100}
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-muted"
            aria-hidden="true"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </div>
        <span className="field-hint">The bar to clear - these are the must-haves.</span>
      </div>
      <div className="flex flex-wrap items-center gap-2 mt-3" id="refine-skills-list">
        <span className="sq-try-label">Suggestions</span>
        {suggestions.map((skill) => {
          const on = Boolean(find(skill));
          return (
            <button
              key={skill}
              type="button"
              className={`chip-toggle${on ? " is-on" : ""}`}
              aria-pressed={on}
              onClick={() => toggle(skill)}
            >
              {on ? skill : <><span aria-hidden="true">+</span>{skill}</>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
