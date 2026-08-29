import { Layout } from "@/components/layout/layout";
import { Switch, Route, Router as WouterRouter, Redirect, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Login from "@/pages/login";
import Signup from "@/pages/signup";
import Dashboard from "@/pages/dashboard";
import Campaigns from "@/pages/campaigns";
import Keywords from "@/pages/keywords";
import Reports from "@/pages/reports";
import Trends from "@/pages/trends";
import Creator from "@/pages/creator";
import TrafficManager from "@/pages/traffic-manager";
import DrCash from "@/pages/drcash";
import LandingPage from "@/pages/landing";
import CheckoutPage from "@/pages/checkout";
import PricingPage from "@/pages/pricing";
import AdminPage from "@/pages/admin";
import AdminLoginPage from "@/pages/admin-login";
import SupportPage from "@/pages/support";
import TrackingPage from "@/pages/tracking";
import DomainsPage from "@/pages/domains";
import ApiPostbacksPage from "@/pages/api-postbacks";
import ActivityPage from "@/pages/activity";
import ApiEventsPage from "@/pages/api-events";
import { GoogleAdsGate } from "@/components/google-ads/google-ads-gate";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

function isAuthenticated(): boolean {
  return !!localStorage.getItem("ads_token");
}

function ProtectedRoute({ component: Component, requiresGoogleAds = false, ...rest }: any) {
  return (
    <Route {...rest}>
      {() => {
        if (!isAuthenticated()) {
          return <Redirect to="/login" />;
        }
        return (
          <Layout>
            {requiresGoogleAds ? (
              <GoogleAdsGate><Component /></GoogleAdsGate>
            ) : (
              <Component />
            )}
          </Layout>
        );
      }}
    </Route>
  );
}


function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/signup" component={Signup} />
      <Route path="/" component={LandingPage} />
      <Route path="/checkout" component={CheckoutPage} />
      <Route path="/admin/login" component={AdminLoginPage} />
      <Route path="/admin" component={AdminPage} />
      <ProtectedRoute path="/dashboard" component={Dashboard} requiresGoogleAds />
      <ProtectedRoute path="/campaigns" component={Campaigns} requiresGoogleAds />
      <ProtectedRoute path="/keywords" component={Keywords} requiresGoogleAds />
      <ProtectedRoute path="/reports" component={Reports} requiresGoogleAds />
      <ProtectedRoute path="/trends" component={Trends} />
      <ProtectedRoute path="/creator" component={Creator} />
      <ProtectedRoute path="/traffic-manager" component={TrafficManager} />
      <ProtectedRoute path="/tracking" component={TrackingPage} />
      <ProtectedRoute path="/activity" component={ActivityPage} />
      <ProtectedRoute path="/domains" component={DomainsPage} />
      <ProtectedRoute path="/postbacks" component={ApiPostbacksPage} />
      <ProtectedRoute path="/postbacks/:id" component={ApiEventsPage} />
      <ProtectedRoute path="/drcash" component={DrCash} />
      <ProtectedRoute path="/support" component={SupportPage} />
      <ProtectedRoute path="/pricing" component={PricingPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

import { useEffect } from "react";

function App() {
  // Keep the product's white-and-blue visual system as the default.
  useEffect(() => {
    if (typeof document !== "undefined") {
      const savedTheme = "light";
      localStorage.setItem("app_theme", savedTheme);
      if (savedTheme === "light") {
        document.documentElement.classList.add("light");
      } else {
        document.documentElement.classList.remove("light");
      }
    }
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
