export function DeathWatermark({ className }: { readonly className: string }) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 64 64">
      <path
        className="death-watermark__body"
        d="M32 4 18 7 10 15 8 24 2 20l3 12 7 5 3 9 7 4v8h6v-6l4 2 4-2v6h6v-8l7-4 3-9 7-5 3-12-6 4-2-9-8-8z"
      />
      <path
        className="death-watermark__cutout"
        d="m17 27 11-2-3 11-5 2-5-5zm30 0-11-2 3 11 5 2 5-5zM29 42l3-5 3 5-3 3zM24 50h3v7h-3zm7 2h2v6h-2zm6-2h3v7h-3z"
      />
    </svg>
  );
}
