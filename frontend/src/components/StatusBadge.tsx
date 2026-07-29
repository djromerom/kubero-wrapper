interface Props {
  status: string;
}

const colors: Record<string, string> = {
  pending: 'bg-yellow-900 text-yellow-200',
  building: 'bg-blue-900 text-blue-200',
  running: 'bg-green-900 text-green-200',
  failed: 'bg-red-900 text-red-200',
  deleted: 'bg-gray-700 text-gray-300',
};

export default function StatusBadge({ status }: Props) {
  return (
    <span className={`px-2 py-1 rounded text-xs font-medium ${colors[status] || 'bg-gray-700 text-gray-300'}`}>
      {status}
    </span>
  );
}
