import type { ComponentType, ReactNode } from 'react';
import WidgetGrid from '@/components/widgets/WidgetGrid';
import {
  EXERCISE_WIDGET_KEY,
  generateDefaultLayouts,
  isMealWidgetKey,
  type DashboardLayouts,
} from '@/utils/dashboardLayout';

export interface DiaryWidget {
  key: string;
  title: string;
  icon: ComponentType<{ className?: string }>;
  render: () => ReactNode;
}

interface DiaryWidgetGridProps {
  widgets: DiaryWidget[];
  toolbarContainer?: HTMLElement | null;
}

const PAGE_KEY = 'diary';

// The exercise widget is only present while acting on behalf of another user,
// so the default layout has to be asked for the same set the page is rendering
// rather than assuming a fixed one.
const diaryDefaultLayouts = (widgetKeys: string[]): DashboardLayouts =>
  generateDefaultLayouts(
    widgetKeys.filter(isMealWidgetKey),
    widgetKeys.includes(EXERCISE_WIDGET_KEY)
  );

const DiaryWidgetGrid = ({
  widgets,
  toolbarContainer,
}: DiaryWidgetGridProps) => (
  <WidgetGrid
    pageKey={PAGE_KEY}
    widgets={widgets}
    generateDefaultLayouts={diaryDefaultLayouts}
    toolbarContainer={toolbarContainer}
  />
);

export default DiaryWidgetGrid;
