import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '~/components/ui';
import { useReactTable, getCoreRowModel, flexRender, type ColumnDef } from '@tanstack/react-table';
import {
  GPTIcon,
  AnthropicIcon,
  GoogleMinimalIcon,
  AssistantIcon,
  BedrockIcon,
  MinimalPlugin,
} from '~/components/svg';
import UnknownIcon from '~/components/Chat/Menus/Endpoints/UnknownIcon';
import { cn } from '~/utils';
import { EModelEndpoint } from 'librechat-data-provider';
import { useGetModelsQuery } from 'librechat-data-provider/react-query';
import { useAuthContext } from '~/hooks/AuthContext';
import { RefreshCcwIcon } from 'lucide-react';
import { EndpointURLs } from 'librechat-data-provider';

interface ModelStatus {
  endpoint: string;
  model: string;
  status: string;
  type: EModelEndpoint;
}

const STATUS_CLASSES = {
  Active: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  'Testing...': 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300',
  Inactive: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
  Unavailable: 'bg-gray-100 text-gray-700 dark:bg-gray-900 dark:text-gray-300',
  None: 'bg-gray-100 text-gray-700 dark:bg-gray-900 dark:text-gray-300',
};

const STATUS_ORDER = {
  Active: 0,
  'Testing...': 1,
  Inactive: 2,
  Unavailable: 3,
  None: 4,
};

const getModelIcon = (type: EModelEndpoint) => {
  const iconProps = { className: 'h-5 w-5' };
  const iconMap = {
    [EModelEndpoint.openAI]: <GPTIcon {...iconProps} />,
    [EModelEndpoint.azureOpenAI]: <GPTIcon {...iconProps} />,
    [EModelEndpoint.anthropic]: <AnthropicIcon {...iconProps} />,
    [EModelEndpoint.google]: <GoogleMinimalIcon {...iconProps} />,
    [EModelEndpoint.assistants]: <AssistantIcon {...iconProps} />,
    [EModelEndpoint.azureAssistants]: <AssistantIcon {...iconProps} />,
    [EModelEndpoint.bedrock]: <BedrockIcon {...iconProps} />,
    [EModelEndpoint.gptPlugins]: <MinimalPlugin {...iconProps} />,
  };
  return iconMap[type] ?? <UnknownIcon {...iconProps} context="menu-item" endpoint={type} />;
};

const getUrlAndEndpointType = (endpoint: string) => {
  const custom = ['OpenRouter', 'groq', 'Mistral', 'Portkey'];
  const isCustom = custom.includes(endpoint);

  const url = isCustom ? EndpointURLs.custom : EndpointURLs[endpoint as EModelEndpoint];
  const endpointType = isCustom ? EModelEndpoint.custom : undefined;

  return { url, endpointType };
};

const getRequestBody = (endpoint: string, model: string, endpointType?: string) => ({
  text: 'This prompt used for status check please answer only ok if it is working',
  sender: 'User',
  clientTimestamp: new Date().toISOString(),
  isCreatedByUser: true,
  parentMessageId: '00000000-0000-0000-0000-000000000000',
  conversationId: crypto.randomUUID(),
  messageId: crypto.randomUUID(),
  error: false,
  generation: '',
  responseMessageId: null,
  overrideParentMessageId: null,
  endpoint,
  model,
  key: 'never',
  isContinued: false,
  isTemporary: true,
  endpointType,
});

export default function ModelsStatus() {
  const { token } = useAuthContext();
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [buttonLoading, setButtonLoading] = useState<string | null>(null);
  const [shouldCheck, setShouldCheck] = useState(false);

  const { data: modelsData = {} } = useGetModelsQuery({
    refetchOnMount: 'always',
    cacheTime: 0,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  const endpointKeys = useMemo(() => Object.keys(modelsData), [modelsData]);

  const testModel = useCallback(
    async (endpoint: string, model: string) => {
      const key = `${endpoint}-${model}`;
      setButtonLoading(key);
      setStatuses((prev) => ({ ...prev, [key]: 'Testing...' }));

      const { url, endpointType } = getUrlAndEndpointType(endpoint);
      const body = getRequestBody(endpoint, model, endpointType);

      try {
        const res = await fetch(url!, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
        });

        const text = await res.text();
        const isActive = res.ok && !text.includes('event: error');
        setStatuses((prev) => ({ ...prev, [key]: isActive ? 'Active' : 'Inactive' }));
      } catch (err) {
        console.error(`Error on ${key}`, err);
      } finally {
        setButtonLoading(null);
      }
    },
    [token],
  );

  const testAllModels = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all(
        endpointKeys.map((endpoint) =>
          Promise.all(
            (modelsData[endpoint] || []).map((model: string) => testModel(endpoint, model)),
          ),
        ),
      );
    } catch (err) {
      console.error('Testing all models failed', err);
    } finally {
      setLoading(false);
    }
  }, [endpointKeys, modelsData, testModel]);

  useEffect(() => {
    const timer = setTimeout(() => setShouldCheck(true), 1000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (shouldCheck && token) {testAllModels();}
  }, [shouldCheck, token, testAllModels]);

  const sortedData = useMemo(() => {
    const data: ModelStatus[] = endpointKeys.flatMap((endpoint) => {
      const models = modelsData[endpoint] || [];
      const type = endpoint as EModelEndpoint;

      return models.length > 0
        ? models.map((model: string) => ({
          endpoint,
          model,
          type,
          status: statuses[`${endpoint}-${model}`] ?? 'None',
        }))
        : [{ endpoint, model: 'No models available', status: 'Unavailable', type }];
    });

    return data;
  }, [endpointKeys, modelsData, statuses]);

  const columns: ColumnDef<ModelStatus>[] = [
    {
      accessorKey: 'endpoint',
      header: 'Endpoint',
      cell: ({ row }) => {
        const { type, endpoint } = row.original;
        return (
          <div className="flex items-center gap-2">
            {getModelIcon(type)}
            <span>{endpoint}</span>
          </div>
        );
      },
    },
    { accessorKey: 'model', header: 'Model' },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => {
        const { status } = row.original;
        return (
          <span
            className={cn(
              'inline-flex items-center rounded-full px-2 py-1 text-xs font-medium',
              STATUS_CLASSES[status],
            )}
          >
            {status}
          </span>
        );
      },
    },
    {
      id: 'action',
      header: 'Actions',
      cell: ({ row }) => {
        const { endpoint, model } = row.original;
        const key = `${endpoint}-${model}`;
        return (
          <button
            onClick={() => testModel(endpoint, model)}
            disabled={loading || !!buttonLoading}
            className="disabled:bg-surface-disabled inline-flex items-center justify-center rounded-md bg-surface-secondary px-3 py-1.5 text-xs text-text-primary hover:bg-surface-tertiary focus:outline-none focus:ring-2 focus:ring-surface-secondary focus:ring-opacity-50 disabled:cursor-not-allowed"
          >
            {buttonLoading === key ? (
              <svg
                className="h-4 w-4 animate-spin text-text-secondary"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8v4l3.5-3.5L12 0v4a8 8 0 01-8 8z"
                />
              </svg>
            ) : (
              <RefreshCcwIcon className="h-4 w-4" />
            )}
          </button>
        );
      },
    },
  ];

  const table = useReactTable({ data: sortedData, columns, getCoreRowModel: getCoreRowModel() });

  return (
    <div className="container mx-auto p-4">
      <div className="rounded-lg border border-border-light bg-transparent shadow-sm">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id}>
                {group.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    className="bg-surface-secondary py-3 text-left text-sm font-medium text-text-secondary"
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => {
              const { status } = row.original;
              const isActive = status === 'Active';
              return (
                <TableRow
                  key={row.id}
                  className={cn('hover:bg-surface-secondary', isActive ? 'bg-green-50' : '')}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className="py-2 text-sm">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
