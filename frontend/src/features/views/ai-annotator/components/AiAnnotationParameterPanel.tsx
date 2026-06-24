import { useState } from 'react';
import { ChevronDown, ChevronUp, Wrench } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { ColumnInfo } from '@/features/workspace/data-view/utils/columnTypes';
import type { UseTabNodeInputsResult } from '../../common/nodeInputs';
import { AiAnnotationNodeColumnFields } from './AiAnnotationNodeColumnFields';
import type { EndpointPreset } from '../hooks/useAiAnnotationSettings';

interface AiAnnotationParameterPanelProps {
  nodeInputs: UseTabNodeInputsResult;
  textColumn: string;
  textColumns: ColumnInfo[];
  annotationColumn: string;
  annotationColumns: ColumnInfo[];
  endpointPreset: EndpointPreset;
  model: string;
  modelNames: string[];
  isLoadingModels: boolean;
  customBaseUrl: string;
  apiKey: string;
  classesText: string;
  examplesText: string;
  temperature: string;
  topP: string;
  seed: string;
  batchSize: string;
  onNodeColumnChange: (nodeId: string, column: string) => void;
  onTextColumnChange: (column: string) => void;
  onAnnotationColumnChange: (column: string) => void;
  onEndpointPresetChange: (preset: EndpointPreset) => void;
  onModelChange: (model: string) => void;
  onCustomBaseUrlChange: (url: string) => void;
  onApiKeyChange: (apiKey: string) => void;
  onClassesTextChange: (classes: string) => void;
  onExamplesTextChange: (examples: string) => void;
  onTemperatureChange: (temperature: string) => void;
  onTopPChange: (topP: string) => void;
  onSeedChange: (seed: string) => void;
  onBatchSizeChange: (batchSize: string) => void;
}

/**
 * Renders the AI Annotation tab's run-parameter form.
 * Rendered by: AiAnnotatorFeature inside the "AI Annotation" tab because the
 * feature shell owns task lifecycle and tab composition while this component
 * owns the editable provider/model/prompt controls.
 * Flow: render the common node/text/annotation pickers, provider/model/API key
 * fields, required class schema textarea, and an expandable advanced section
 * for sampling, seed, batch size, and few-shot examples.
 */
export function AiAnnotationParameterPanel({
  nodeInputs,
  textColumn,
  textColumns,
  annotationColumn,
  annotationColumns,
  endpointPreset,
  model,
  modelNames,
  isLoadingModels,
  customBaseUrl,
  apiKey,
  classesText,
  examplesText,
  temperature,
  topP,
  seed,
  batchSize,
  onNodeColumnChange,
  onTextColumnChange,
  onAnnotationColumnChange,
  onEndpointPresetChange,
  onModelChange,
  onCustomBaseUrlChange,
  onApiKeyChange,
  onClassesTextChange,
  onExamplesTextChange,
  onTemperatureChange,
  onTopPChange,
  onSeedChange,
  onBatchSizeChange,
}: AiAnnotationParameterPanelProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <div className="space-y-4">
      <section className="space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Commonly Used Parameters</h3>
          <p className="text-xs text-muted-foreground">
            Choose one node, text column, model, and prompt schema.
          </p>
        </div>

        <AiAnnotationNodeColumnFields
          nodeInputs={nodeInputs}
          textColumn={textColumn}
          textColumns={textColumns}
          annotationColumn={annotationColumn}
          annotationColumns={annotationColumns}
          textSelectId="ai-text-column"
          annotationSelectId="ai-annotation-column"
          annotationEmptyOption={{
            value: '__none__',
            label: 'Create new annotation column',
          }}
          onNodeColumnChange={onNodeColumnChange}
          onTextColumnChange={onTextColumnChange}
          onAnnotationColumnChange={onAnnotationColumnChange}
        />

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="ai-annotator-endpoint-preset">Endpoint</Label>
            <Select
              value={endpointPreset}
              onValueChange={(value) => {
                onEndpointPresetChange(value as EndpointPreset);
              }}
            >
              <SelectTrigger id="ai-annotator-endpoint-preset">
                <SelectValue placeholder="Select endpoint" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="openai">OpenAI</SelectItem>
                <SelectItem value="lmstudio">http://127.0.0.1:1234 (LM Studio)</SelectItem>
                <SelectItem value="custom">Custom</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className={`space-y-2 ${endpointPreset === 'custom' ? '' : 'md:col-span-2'}`}>
            <Label htmlFor="ai-annotator-model">Model</Label>
            <Select value={model} onValueChange={onModelChange}>
              <SelectTrigger id="ai-annotator-model">
                <SelectValue
                  placeholder={
                    isLoadingModels ? 'Loading models...' : 'Click "Refresh Models" to load'
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {modelNames.map((modelName) => (
                  <SelectItem key={modelName} value={modelName}>
                    {modelName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {endpointPreset === 'custom' ? (
            <div className="space-y-2">
              <Label htmlFor="ai-annotator-custom-url">Custom Base URL</Label>
              <Input
                id="ai-annotator-custom-url"
                value={customBaseUrl}
                onChange={(event) => {
                  onCustomBaseUrlChange(event.target.value);
                }}
                placeholder="e.g. http://localhost:11434/v1"
              />
            </div>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label htmlFor="ai-annotator-api-key">API Key</Label>
          <Input
            id="ai-annotator-api-key"
            type="password"
            value={apiKey}
            onChange={(event) => {
              onApiKeyChange(event.target.value);
            }}
            placeholder={
              endpointPreset === 'openai' ? 'Required for OpenAI' : 'Leave blank if not needed'
            }
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="ai-annotator-classes">Classes (one per line, `name: description`)</Label>
          <textarea
            id="ai-annotator-classes"
            value={classesText}
            onChange={(event) => {
              onClassesTextChange(event.target.value);
            }}
            className="min-h-27.5 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            placeholder="support: Supportive stance"
          />
        </div>
      </section>

      <section className="space-y-4">
        <Button
          type="button"
          variant="ghost"
          className="h-auto px-0 text-sm"
          onClick={() => {
            setShowAdvanced((value) => !value);
          }}
        >
          <Wrench className="mr-2 h-4 w-4" />
          Advanced Parameters
          {showAdvanced ? (
            <ChevronUp className="ml-2 h-4 w-4" />
          ) : (
            <ChevronDown className="ml-2 h-4 w-4" />
          )}
        </Button>

        {showAdvanced ? (
          <div className="space-y-4 rounded-md border border-border/60 bg-muted/20 p-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
              <div className="space-y-2">
                <Label htmlFor="ai-annotator-temperature">Temperature</Label>
                <Input
                  id="ai-annotator-temperature"
                  type="number"
                  step="0.1"
                  min="0"
                  value={temperature}
                  onChange={(event) => {
                    onTemperatureChange(event.target.value);
                  }}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="ai-annotator-top-p">Top P</Label>
                <Input
                  id="ai-annotator-top-p"
                  type="number"
                  step="0.05"
                  min="0"
                  max="1"
                  value={topP}
                  onChange={(event) => {
                    onTopPChange(event.target.value);
                  }}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="ai-annotator-seed">Seed</Label>
                <Input
                  id="ai-annotator-seed"
                  type="number"
                  value={seed}
                  onChange={(event) => {
                    onSeedChange(event.target.value);
                  }}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="ai-annotator-batch-size">Batch Size</Label>
                <Input
                  id="ai-annotator-batch-size"
                  type="number"
                  min="1"
                  value={batchSize}
                  onChange={(event) => {
                    onBatchSizeChange(event.target.value);
                  }}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ai-annotator-examples">
                Examples (one per line, query to class format)
              </Label>
              <textarea
                id="ai-annotator-examples"
                value={examplesText}
                onChange={(event) => {
                  onExamplesTextChange(event.target.value);
                }}
                className="min-h-27.5 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                placeholder="This policy is fair => support"
              />
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
