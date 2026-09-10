export function PageHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="flex h-11 shrink-0 items-center border-b border-hairline px-4">
      <div>
        <h1 className="text-sm font-semibold text-text-primary">{title}</h1>
        {description && <p className="text-xs text-text-tertiary">{description}</p>}
      </div>
    </div>
  );
}
