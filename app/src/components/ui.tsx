import React, { ReactNode } from "react";

export function SectionTitle({ children }: { children: ReactNode }) {
  return <div className="se-section-title">{children}</div>;
}

export function DetailLabel({ children }: { children: ReactNode }) {
  return <span className="se-detail-label">{children}</span>;
}

export function HintLabel({ children }: { children: ReactNode }) {
  return <span className="se-hint-label">{children}</span>;
}

export function WarnLabel({ children }: { children: ReactNode }) {
  return <div className="se-warn-label">{children}</div>;
}

export function InfoCard({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="se-card">
      {title ? <SectionTitle>{title}</SectionTitle> : null}
      {children}
    </div>
  );
}

export function FieldGrid({ children }: { children: ReactNode }) {
  return <div className="se-field-grid">{children}</div>;
}

export function Button({
  children,
  onClick,
  disabled,
  primary,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  primary?: boolean;
  title?: string;
}) {
  return (
    <button className={primary ? "primary" : undefined} onClick={onClick} disabled={disabled} title={title}>
      {children}
    </button>
  );
}

export function TextField({
  value,
  placeholder,
  onChange,
  readOnly,
  onBlur,
}: {
  value: string;
  placeholder?: string;
  onChange?: (v: string) => void;
  readOnly?: boolean;
  onBlur?: () => void;
}) {
  return (
    <input
      type="text"
      className="se-drop-input"
      value={value}
      placeholder={placeholder}
      readOnly={readOnly}
      onChange={(e) => onChange?.(e.target.value)}
      onBlur={onBlur}
    />
  );
}

export function NumberField({
  value,
  placeholder,
  onChange,
  min,
  max,
  step,
  suffix,
}: {
  value: string | number;
  placeholder?: string;
  onChange?: (v: string) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <input
        type="number"
        className="se-drop-input"
        value={value}
        placeholder={placeholder}
        min={min}
        max={max}
        step={step ?? 1}
        onChange={(e) => onChange?.(e.target.value)}
        style={{ flex: 1 }}
      />
      {suffix ? <span className="se-hint-label">{suffix}</span> : null}
    </div>
  );
}
