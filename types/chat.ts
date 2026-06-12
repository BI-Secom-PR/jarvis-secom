export type Role = 'user' | 'ai';

export interface ChartDataset {
  label: string;
  data: number[];
}

export interface ChartData {
  type: 'bar' | 'line' | 'area' | 'pie';
  title?: string;
  labels: string[];
  datasets: ChartDataset[];
}

export interface Message {
  id: string;
  role: Role;
  text: string;
  chartData?: ChartData;
}

