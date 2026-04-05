export function TeamAlignedLogo({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path d="M16 4L6 22h5.5L16 13l4.5 9H26L16 4Z" fill="currentColor" />
      <rect x="9" y="24" width="14" height="3.5" rx="1.75" fill="currentColor" opacity="0.55" />
    </svg>
  );
}
