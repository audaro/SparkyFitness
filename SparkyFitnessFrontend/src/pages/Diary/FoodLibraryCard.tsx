import React from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Utensils } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { useActiveUser } from '@/contexts/ActiveUserContext';

/**
 * The way into the food library from the Food page.
 *
 * The library stopped being a top-level tab: `/` is the day and `/exercises` is
 * training, and a database of every food you can log is neither. It is still a
 * page — this is a link, not a fold-in — because mounting the foods table,
 * meals and the meal-plan calendar would put three more list queries and their
 * components on the app's landing route, which is the one page every session
 * starts on. Mobile made the same call in reverse order and for the same
 * reason: its Food tab links to the library screens rather than inlining them,
 * explicitly to keep the counts off the tab's cold load.
 *
 * Hidden while acting on behalf of someone else, which is the state that never
 * had a Foods tab to lose.
 */
const FoodLibraryCard: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { isActingOnBehalf } = useActiveUser();

  if (isActingOnBehalf) {
    return null;
  }

  return (
    <Card>
      <CardContent className="p-0">
        <button
          type="button"
          onClick={() => navigate('/foods')}
          className="flex w-full items-center gap-3 rounded-lg p-4 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Utensils className="h-5 w-5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">
              {t('foodLibrary.title', 'Food library')}
            </span>
            <span className="block text-sm text-muted-foreground">
              {t(
                'foodLibrary.description',
                'Foods, meals and meal plans you can log from'
              )}
            </span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      </CardContent>
    </Card>
  );
};

export default FoodLibraryCard;
