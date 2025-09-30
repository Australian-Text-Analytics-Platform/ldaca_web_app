import React, { useEffect } from 'react';
import { useFilePreview } from '../../hooks/useFilePreview';
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from '../ui/dialog';
import { Button } from '../ui/button';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '../ui/select';

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
		<Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
			<DialogContent className="max-w-5xl max-h-[85vh] flex flex-col">
				<DialogHeader>
					<DialogTitle className="truncate">Preview: {filename}</DialogTitle>
				</DialogHeader>
				
				<div className="overflow-auto px-1">
					{loading ? (
						<div className="py-12 text-center text-muted-foreground">Loading…</div>
					) : error ? (
						<div className="py-12 text-center text-destructive">{error}</div>
					) : previewData.length === 0 ? (
						<div className="py-12 text-center text-muted-foreground">No preview data</div>
					) : (
						<div className="w-full overflow-auto">
							<table className="min-w-full text-sm">
								<thead>
									<tr className="bg-muted">
										{columns.map(col => (
											<th key={col} className="text-left px-3 py-2 font-medium whitespace-nowrap">{col}</th>
										))}
									</tr>
								</thead>
								<tbody>
									{previewData.map((row, idx) => (
										<tr key={idx} className="odd:bg-background even:bg-muted/50">
											{columns.map(col => (
												<td key={col} className="px-3 py-2 whitespace-nowrap">{String(row[col] ?? '')}</td>
											))}
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
				</div>
				
				<div className="flex items-center justify-between pt-3 border-t">
					<div className="text-xs text-muted-foreground">
						Page {page + 1}{totalRows ? ` of ~${Math.ceil(totalRows / pageSize)}` : ''}
					</div>
					<div className="flex items-center space-x-2">
						<Button
							onClick={onPrev}
							disabled={!canPrev || loading}
							variant="outline"
							size="sm"
						>Prev</Button>
						<Button
							onClick={onNext}
							disabled={!canNext || loading}
							variant="outline"
							size="sm"
						>Next</Button>
						<Select value={String(pageSize)} onValueChange={(val) => setPageSize(Number(val))}>
							<SelectTrigger className="w-20">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="10">10</SelectItem>
								<SelectItem value="25">25</SelectItem>
								<SelectItem value="50">50</SelectItem>
								<SelectItem value="100">100</SelectItem>
							</SelectContent>
						</Select>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
};

export default FilePreviewModal;

