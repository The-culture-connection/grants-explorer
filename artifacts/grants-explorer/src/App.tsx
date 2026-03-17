import { useEffect } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Home from "@/pages/Home";
import AlgorithmPage from "@/pages/Algorithm";
import IndexingToolPage from "@/pages/IndexingTool";
import AlgorithmAuditPage from "@/pages/AlgorithmAudit";
import ProfileCreation from "@/pages/ProfileCreation";
import { AuthProvider, useAuth } from "@/context/AuthContext";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1000,
      retry: 1,
    },
  },
});

function ProtectedHome() {
  const { user, loading } = useAuth();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (!loading && !user) {
      navigate("/profilecreation");
    }
  }, [loading, user, navigate]);

  if (loading || !user) return null;
  return <Home />;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={ProtectedHome} />
      <Route path="/profilecreation" component={ProfileCreation} />
      <Route path="/algorithm" component={AlgorithmPage} />
      <Route path="/indexing" component={IndexingToolPage} />
      <Route path="/audit" component={AlgorithmAuditPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={300}>
        <AuthProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
        </AuthProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
