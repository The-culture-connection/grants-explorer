import React from "react";
import { format, isValid, parseISO } from "date-fns";
import { motion } from "framer-motion";
import { ExternalLink, Building2, Calendar, DollarSign, Bookmark, CheckCircle, BookmarkCheck } from "lucide-react";
import { GrantItem } from "@workspace/api-client-react/src/generated/api.schemas";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export type GrantStatus = "saved" | "applied" | "won" | null;

interface GrantCardProps {
  grant: GrantItem;
  index: number;
  status?: GrantStatus;
  onSave?: (grant: GrantItem) => void;
  onApply?: (grant: GrantItem) => void;
}

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 300, damping: 24 } }
};

export function GrantCard({ grant, index, status, onSave, onApply }: GrantCardProps) {
  const formatAmount = (amount?: string) => {
    if (!amount) return "Amount not specified";
    const num = parseFloat(amount.replace(/[^0-9.-]+/g, ""));
    if (isNaN(num)) return amount;
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(num);
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return "Ongoing / Not specified";
    try {
      const parsed = parseISO(dateStr);
      if (isValid(parsed)) return format(parsed, "MMM d, yyyy");
    } catch { /* ignore */ }
    return dateStr;
  };

  const isClosed = grant.status?.toLowerCase().includes("closed") || grant.status?.toLowerCase().includes("archived");
  const isSaved   = status === "saved";
  const isApplied = status === "applied" || status === "won";

  return (
    <motion.div variants={itemVariants}>
      <Card className="h-full flex flex-col group hover:shadow-xl hover:border-primary/30 transition-all duration-300 bg-card overflow-hidden">
        <CardHeader className="pb-4 items-start gap-4 space-y-0">
          <div className="flex justify-between w-full items-start gap-4">
            <Badge
              variant={isClosed ? "secondary" : "default"}
              className={`font-medium ${!isClosed ? 'bg-primary/10 text-primary hover:bg-primary/20 hover:text-primary' : ''}`}
            >
              {grant.status || "Active"}
            </Badge>
            {grant.id && (
              <span className="text-xs text-muted-foreground font-mono bg-muted/50 px-2 py-1 rounded-md">
                ID: {grant.id}
              </span>
            )}
          </div>
          <h3 className="font-display font-semibold text-lg leading-tight line-clamp-2 text-foreground group-hover:text-primary transition-colors">
            {grant.title}
          </h3>
        </CardHeader>

        <CardContent className="flex-grow pb-4 space-y-4">
          {grant.description && (
            <p className="text-sm text-muted-foreground line-clamp-3 leading-relaxed">
              {grant.description}
            </p>
          )}
          <div className="grid grid-cols-1 gap-3 pt-2">
            {grant.agency && (
              <div className="flex items-center gap-2 text-sm text-foreground/80">
                <Building2 className="w-4 h-4 text-muted-foreground shrink-0" />
                <span className="truncate" title={grant.agency}>{grant.agency}</span>
              </div>
            )}
            <div className="flex items-center gap-2 text-sm text-foreground/80">
              <DollarSign className="w-4 h-4 text-emerald-600 shrink-0" />
              <span className="font-medium text-emerald-700 dark:text-emerald-400">
                {formatAmount(grant.amount)}
              </span>
            </div>
            <div className="flex items-center gap-2 text-sm text-foreground/80">
              <Calendar className="w-4 h-4 text-amber-600 shrink-0" />
              <span className={isClosed ? "line-through text-muted-foreground" : "text-amber-700 dark:text-amber-400"}>
                {formatDate(grant.deadline)}
              </span>
            </div>
          </div>
        </CardContent>

        <CardFooter className="pt-3 border-t border-border/50 bg-muted/20 flex flex-col gap-2">
          {/* Save / Apply row */}
          {(onSave || onApply) && (
            <div className="flex gap-2 w-full">
              {onSave && (
                <button
                  onClick={() => onSave(grant)}
                  className={`flex-1 flex items-center justify-center gap-1.5 h-8 rounded-lg text-xs font-medium border transition-all ${
                    isSaved
                      ? "bg-primary/10 border-primary/30 text-primary"
                      : "border-border/60 text-muted-foreground hover:border-primary/40 hover:text-primary hover:bg-primary/5"
                  }`}
                >
                  {isSaved
                    ? <><BookmarkCheck className="h-3.5 w-3.5" /> Saved</>
                    : <><Bookmark className="h-3.5 w-3.5" /> Save</>
                  }
                </button>
              )}
              {onApply && (
                <button
                  onClick={() => onApply(grant)}
                  className={`flex-1 flex items-center justify-center gap-1.5 h-8 rounded-lg text-xs font-medium border transition-all ${
                    isApplied
                      ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-400"
                      : "border-border/60 text-muted-foreground hover:border-emerald-500/40 hover:text-emerald-700 hover:bg-emerald-500/5"
                  }`}
                >
                  {isApplied
                    ? <><CheckCircle className="h-3.5 w-3.5" /> Applied</>
                    : <><CheckCircle className="h-3.5 w-3.5" /> Mark Applied</>
                  }
                </button>
              )}
            </div>
          )}
          {/* View details */}
          <Button
            asChild
            variant="ghost"
            className="w-full justify-between group/btn hover:bg-primary hover:text-primary-foreground transition-colors h-8 text-xs"
          >
            <a href={grant.url || "#"} target="_blank" rel="noopener noreferrer" onClick={(e) => !grant.url && e.preventDefault()}>
              <span>{grant.url ? "View Official Details" : "No link available"}</span>
              <ExternalLink className="w-3.5 h-3.5 opacity-50 group-hover/btn:opacity-100 group-hover/btn:translate-x-0.5 group-hover/btn:-translate-y-0.5 transition-all" />
            </a>
          </Button>
        </CardFooter>
      </Card>
    </motion.div>
  );
}
