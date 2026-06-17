export type Role = 'user' | 'ai';

export interface ScatterPoint {
  x: number;
  y: number;
}

export interface ChartDataset {
  label: string;
  data: number[] | ScatterPoint[];
  meta?: Record<string, string | number>[];
}

export interface ChartData {
  type: 'bar' | 'line' | 'area' | 'pie' | 'scatter' | 'geo';
  title?: string;
  labels?: string[];
  datasets: ChartDataset[];
  xLabel?: string;
  yLabel?: string;
}

export interface Message {
  id: string;
  role: Role;
  text: string;
  chartData?: ChartData;
}

