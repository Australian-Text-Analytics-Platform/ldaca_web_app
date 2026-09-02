const NON_FOCUSED_OPACITY = 0.45;

type EChartsSeriesStatesConfig =
  | { chartType: 'bar' }
  | { chartType: 'line'; selectedIndices?: ReadonlySet<number> }
  | { chartType: 'area'; areaOpacity: number; selectedIndices?: ReadonlySet<number> };

/** Shared native ECharts focus and point-selection states for analysis charts. */
export const buildEChartsSeriesStates = (config: EChartsSeriesStatesConfig) => {
  if (config.chartType === 'bar') {
    return {
      emphasis: { focus: 'series' as const },
      blur: { itemStyle: { opacity: NON_FOCUSED_OPACITY } },
    };
  }

  return {
    emphasis: { focus: 'series' as const, scale: false },
    blur: {
      itemStyle: { opacity: NON_FOCUSED_OPACITY },
      lineStyle: { opacity: NON_FOCUSED_OPACITY },
      ...(config.chartType === 'area'
        ? { areaStyle: { opacity: config.areaOpacity * NON_FOCUSED_OPACITY } }
        : {}),
    },
    ...(config.selectedIndices?.size
      ? {
          showSymbol: true,
          symbol: (_value: unknown, params: { dataIndex?: number }) =>
            config.selectedIndices?.has(params.dataIndex ?? -1) ? 'circle' : 'emptyCircle',
          symbolSize: 6,
        }
      : {}),
  };
};
