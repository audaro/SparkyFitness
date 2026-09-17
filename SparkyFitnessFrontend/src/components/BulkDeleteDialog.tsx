import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface BulkDeleteDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  selectedCount: number;
  entityName?: string;
  /**
   * Overrides the generic "cannot be undone" line. Use it where the outcome is
   * narrower than it sounds -- deleting library items, for instance, keeps the
   * diary history logged from them.
   */
  description?: string;
}

const BulkDeleteDialog: React.FC<BulkDeleteDialogProps> = ({
  isOpen,
  onOpenChange,
  onConfirm,
  selectedCount,
  entityName,
  description,
}) => {
  const { t } = useTranslation();

  return (
    <AlertDialog open={isOpen} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t('common.bulkDeleteTitle', {
              count: selectedCount,
              selectedCount,
              entity: entityName || t('common.items', 'items'),
              entityName: entityName || t('common.items', 'items'),
              defaultValue: `Delete ${selectedCount} ${entityName || 'items'}?`,
            })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {description ??
              t('common.bulkDeleteDescription', {
                count: selectedCount,
                selectedCount,
                defaultValue: `Are you sure you want to delete these ${selectedCount} items? This action cannot be undone.`,
              })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('common.cancel', 'Cancel')}</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {t('common.delete', 'Delete')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default BulkDeleteDialog;
