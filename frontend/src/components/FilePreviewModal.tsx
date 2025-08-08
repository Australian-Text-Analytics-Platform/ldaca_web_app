import React, { useEffect } from 'react';
import { useFilePreview } from '../hooks/useFilePreview';

interface FilePreviewModalProps {
	filename: string | null;
	isOpen: boolean;
	onClose: () => void;
}

const FilePreviewModal: React.FC<FilePreviewModalProps> = ({ filename, isOpen, onClose }) => {
	const {
		previewData,
		columns,
		totalRows,
		page,
		pageSize,
		loading,
		error,
		fetchPreview,
		clearPreview,
		setPageSize,
	} = useFilePreview();

	useEffect(() => {
		if (isOpen && filename) {
			fetchPreview(filename, 0);
		} else {
			clearPreview();
		}
	}, [isOpen, filename, fetchPreview, clearPreview]);

	if (!isOpen || !filename) return null;

	const canPrev = page > 0;
	const canNext = totalRows ? (page + 1) * pageSize < totalRows : true; // allow next if unknown total

	const onPrev = () => {
		if (!filename) return;
		if (canPrev) fetchPreview(filename, page - 1);
	};
	const onNext = () => {
		if (!filename) return;
		if (canNext) fetchPreview(filename, page + 1);
	};

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
			onClick={onClose}
			role="dialog"
			aria-modal="true"
		>
			<div
				className="bg-white rounded-xl shadow-xl w-full max-w-5xl max-h-[85vh] flex flex-col"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="flex items-center justify-between px-5 py-3 border-b">
					<h3 className="font-semibold text-gray-800 truncate">Preview: {filename}</h3>
					<button onClick={onClose} className="text-gray-500 hover:text-gray-700">✕</button>
				</div>
				<div className="p-4 overflow-auto">
					{loading ? (
						<div className="py-12 text-center text-gray-600">Loading…</div>
					) : error ? (
						<div className="py-12 text-center text-red-600">{error}</div>
					) : previewData.length === 0 ? (
						<div className="py-12 text-center text-gray-500">No preview data</div>
					) : (
						<div className="w-full overflow-auto">
							<table className="min-w-full text-sm">
								<thead>
									<tr className="bg-gray-50">
										{columns.map(col => (
											<th key={col} className="text-left px-3 py-2 font-medium text-gray-700 whitespace-nowrap">{col}</th>
										))}
									</tr>
								</thead>
								<tbody>
									{previewData.map((row, idx) => (
										<tr key={idx} className="odd:bg-white even:bg-gray-50">
											{columns.map(col => (
												<td key={col} className="px-3 py-2 text-gray-800 whitespace-nowrap">{String(row[col] ?? '')}</td>
											))}
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
				</div>
				<div className="flex items-center justify-between px-4 py-3 border-t">
					<div className="text-xs text-gray-500">
						Page {page + 1}{totalRows ? ` of ~${Math.ceil(totalRows / pageSize)}` : ''}
					</div>
					<div className="flex items-center space-x-2">
						<button
							onClick={onPrev}
							disabled={!canPrev || loading}
							className="px-3 py-1 text-sm rounded border disabled:opacity-50"
						>Prev</button>
						<button
							onClick={onNext}
							disabled={!canNext || loading}
							className="px-3 py-1 text-sm rounded border disabled:opacity-50"
						>Next</button>
						<select
							className="ml-2 border rounded px-2 py-1 text-sm"
							value={pageSize}
							onChange={(e) => setPageSize(Number(e.target.value))}
						>
							{[10,20,50,100].map(ps => (
								<option key={ps} value={ps}>{ps}/page</option>
							))}
						</select>
					</div>
				</div>
			</div>
		</div>
	);
};

export default FilePreviewModal;

