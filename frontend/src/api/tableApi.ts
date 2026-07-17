import { getNodeRows, getNodeSchema, previewFile, previewNodeCreation } from './generated';
import {
  decodeArrowPage,
  decodeArrowTable,
  type ArrowTableData,
  type ArrowTablePage,
} from '@/lib/arrow/arrowTable';

export async function getNodeRowsTable(
  options: Parameters<typeof getNodeRows>[0],
): Promise<ArrowTablePage> {
  const { data, response } = await getNodeRows({ ...options, throwOnError: true });
  return decodeArrowPage(data, response);
}

export async function getNodeSchemaTable(
  options: Parameters<typeof getNodeSchema>[0],
): Promise<ArrowTableData> {
  const { data } = await getNodeSchema({ ...options, throwOnError: true });
  return decodeArrowTable(data);
}

export async function previewFileTable(
  options: Parameters<typeof previewFile>[0],
): Promise<ArrowTablePage> {
  const { data, response } = await previewFile({ ...options, throwOnError: true });
  return decodeArrowPage(data, response);
}

export async function previewNodeCreationTable(
  options: Parameters<typeof previewNodeCreation>[0],
): Promise<ArrowTablePage> {
  const { data, response } = await previewNodeCreation({ ...options, throwOnError: true });
  return decodeArrowPage(data, response);
}
