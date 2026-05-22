export function NutricellLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 40 40"
      aria-label="NutricellScience"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="20" cy="20" r="18" stroke="currentColor" strokeWidth="2" />
      <path
        d="M14 26 C 14 18, 26 22, 26 14"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <circle cx="14" cy="26" r="2.4" fill="currentColor" />
      <circle cx="26" cy="14" r="2.4" fill="currentColor" />
      <circle cx="20" cy="20" r="1.6" fill="currentColor" />
    </svg>
  );
}
