import type { ResponseAction } from "@/lib/data/types";

const KIND_LABEL: Record<ResponseAction["kind"], string> = {
  isolate_host: "Isolate host",
  disable_account: "Disable account",
  revoke_session: "Revoke session",
  block_indicator: "Block indicator",
  quarantine_file: "Quarantine file",
};

export function ActionList({
  actions,
  selectedId,
  onSelect,
}: {
  actions: ResponseAction[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <ul className="w-80 shrink-0 overflow-y-auto border-r border-hairline">
      {actions.map((action) => (
        <li key={action.id}>
          <button
            type="button"
            onClick={() => onSelect(action.id)}
            aria-current={selectedId === action.id}
            className={`flex w-full flex-col gap-0.5 border-b border-hairline px-3 py-2 text-left transition-colors duration-fast ${
              selectedId === action.id ? "bg-hover" : "hover:bg-hover"
            }`}
          >
            <span className="text-sm font-medium text-text-primary">{KIND_LABEL[action.kind]}</span>
            <span className="truncate font-mono text-xs text-text-secondary">{action.target}</span>
            <span className="text-xs capitalize text-text-tertiary">{action.status}</span>
          </button>
        </li>
      ))}
      {actions.length === 0 && <li className="p-4 text-center text-sm text-text-tertiary">No proposed actions pending.</li>}
    </ul>
  );
}
