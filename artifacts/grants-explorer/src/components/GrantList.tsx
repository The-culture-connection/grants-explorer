import React from "react";
import { motion } from "framer-motion";
import { GrantCard, type GrantStatus } from "./GrantCard";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, FileSearch, Loader2, ChevronDown } from "lucide-react";
import { GrantItem } from "@workspace/api-client-react/src/generated/api.schemas";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

interface GrantListProps {
  items?: GrantItem[];
  isLoading: boolean;
  isLoadingMore?: boolean;
  error: Error | null;
  total?: number;
  sourceName: string;
  onLoadMore?: () => void;
  hasMore?: boolean;
  statuses?: Record<string, GrantStatus>;
  onSave?: (grant: GrantItem) => void;
  onApply?: (grant: GrantItem) => void;
}

const containerVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.05 } }
};

export function GrantList({ items, isLoading, isLoadingMore, error, total, sourceName, onLoadMore, hasMore, statuses, onSave, onApply }: GrantListProps) {
  if (isLoading) {
    return (
      <div className="space-y-6 animate-in fade-in duration-500">
        <div className="flex justify-between items-center px-2">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-6 w-24" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="flex flex-col h-[320px] rounded-xl border border-border/50 bg-card p-6 shadow-sm">
              <Skeleton className="h-6 w-20 mb-4" />
              <Skeleton className="h-6 w-3/4 mb-4" />
              <Skeleton className="h-4 w-full mb-2" />
              <Skeleton className="h-4 w-5/6 mb-6" />
              <div className="space-y-3 mt-auto">
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-4 w-2/5" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive" className="my-8 max-w-2xl mx-auto shadow-md">
        <AlertCircle className="h-5 w-5" />
        <AlertTitle className="text-lg font-display">Connection Error</AlertTitle>
        <AlertDescription className="mt-2 text-sm leading-relaxed">
          Failed to fetch data from <strong>{sourceName}</strong>. The external service might be down, or there is a network issue.
          <br /><br />
          <span className="font-mono text-xs bg-black/10 px-2 py-1 rounded">{error.message || "Unknown error occurred"}</span>
        </AlertDescription>
      </Alert>
    );
  }

  if (!items || items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center px-4">
        <div className="bg-muted/50 p-6 rounded-full mb-6">
          <FileSearch className="h-12 w-12 text-muted-foreground" />
        </div>
        <h3 className="text-2xl font-display font-semibold text-foreground mb-2">No results found</h3>
        <p className="text-muted-foreground max-w-md">
          We couldn't find any grants matching your search criteria in {sourceName}. Try adjusting your keywords or clearing the search.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center px-2 border-b border-border/50 pb-4">
        <h2 className="text-lg font-medium text-foreground">
          Showing results from <span className="font-semibold text-primary">{sourceName}</span>
        </h2>
        {total !== undefined && (
          <div className="text-sm font-medium bg-secondary text-secondary-foreground px-3 py-1 rounded-full">
            {items.length.toLocaleString()} of {total.toLocaleString()}
          </div>
        )}
      </div>

      <motion.div
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
        variants={containerVariants}
        initial="hidden"
        animate="show"
      >
        {items.map((grant, index) => (
          <GrantCard
            key={grant.id || index}
            grant={grant}
            index={index}
            status={grant.id ? (statuses?.[grant.id] ?? null) : null}
            onSave={onSave}
            onApply={onApply}
          />
        ))}
      </motion.div>

      {(hasMore || isLoadingMore) && (
        <div className="flex justify-center pt-4 pb-8">
          <Button
            variant="outline"
            size="lg"
            onClick={onLoadMore}
            disabled={isLoadingMore}
            className="h-12 px-8 rounded-xl border-2 border-border hover:border-primary hover:text-primary font-medium text-base transition-all gap-2"
          >
            {isLoadingMore ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Loading more...</>
            ) : (
              <><ChevronDown className="h-4 w-4" /> Load more results</>
            )}
          </Button>
        </div>
      )}

      {!hasMore && items.length > 0 && total !== undefined && items.length >= total && (
        <p className="text-center text-sm text-muted-foreground pb-6">
          All {total.toLocaleString()} results loaded
        </p>
      )}
    </div>
  );
}
