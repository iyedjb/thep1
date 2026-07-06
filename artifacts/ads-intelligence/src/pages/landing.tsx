import { Link } from "wouter";
import { ShieldCheck, BarChart3, Search, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur sticky top-0 z-50 px-6 py-4 flex items-center justify-between max-w-7xl mx-auto w-full">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center font-bold text-white shadow-lg shadow-blue-500/20">
            C
          </div>
          <span className="font-bold text-lg tracking-tight bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent">
            ClicqLab
          </span>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/login">
            <Button variant="ghost" className="text-slate-300 hover:text-white text-sm">
              Entrar
            </Button>
          </Link>
          <Link href="/signup">
            <Button className="bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm rounded-xl px-4 py-2">
              Criar Conta
            </Button>
          </Link>
        </div>
      </header>

      {/* Hero Section */}
      <main className="flex-1 max-w-6xl mx-auto w-full px-6 py-16 md:py-24 flex flex-col items-center text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-semibold mb-8">
          <ShieldCheck className="w-3.5 h-3.5" />
          Plataforma Homologada Google Ads API
        </div>

        <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight max-w-3xl mb-6 bg-gradient-to-b from-white via-slate-100 to-slate-400 bg-clip-text text-transparent leading-tight">
          Inteligência de Tráfego e Otimização para Google Ads
        </h1>

        <p className="text-slate-400 text-base md:text-lg max-w-2xl mb-10 leading-relaxed">
          Monitore o desempenho de suas campanhas, analise palavras-chave em tempo real, audite a conformidade de suas páginas de vendas e otimize seus anúncios através da nossa integração oficial segura com a API do Google Ads.
        </p>

        <div className="flex flex-col sm:flex-row gap-4 mb-20 w-full sm:w-auto">
          <Link href="/signup">
            <Button className="bg-blue-600 hover:bg-blue-700 text-white font-semibold text-base rounded-xl px-8 py-6 shadow-lg shadow-blue-500/10">
              Começar Grátis
            </Button>
          </Link>
          <Link href="/login">
            <Button variant="outline" className="border-slate-800 hover:bg-slate-900 text-slate-300 font-semibold text-base rounded-xl px-8 py-6">
              Fazer Login
            </Button>
          </Link>
        </div>

        {/* Features Grid */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-8 w-full text-left border-t border-slate-900 pt-16">
          <div className="bg-slate-900/40 border border-slate-900 rounded-2xl p-6 hover:border-slate-800 transition">
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-400 flex items-center justify-center mb-4">
              <BarChart3 className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-lg mb-2">Relatórios Consolidados</h3>
            <p className="text-slate-400 text-sm leading-relaxed">
              Consulte dados analíticos sobre impressões, cliques, custos e ROI de suas campanhas diretamente no seu painel.
            </p>
          </div>

          <div className="bg-slate-900/40 border border-slate-900 rounded-2xl p-6 hover:border-slate-800 transition">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center mb-4">
              <Search className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-lg mb-2">Análise de Palavras-Chave</h3>
            <p className="text-slate-400 text-sm leading-relaxed">
              Descubra tendências de busca e planeje novas palavras-chave para reduzir custos de CPC e aumentar conversões.
            </p>
          </div>

          <div className="bg-slate-900/40 border border-slate-900 rounded-2xl p-6 hover:border-slate-800 transition">
            <div className="w-10 h-10 rounded-xl bg-purple-500/10 text-purple-400 flex items-center justify-center mb-4">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-lg mb-2">Filtro de Compliance</h3>
            <p className="text-slate-400 text-sm leading-relaxed">
              Evite bloqueios em suas campanhas higienizando suas páginas de vendas (pre-sells) contra as políticas de anúncios do Google Ads.
            </p>
          </div>
        </section>

        {/* Legal notice for OAuth */}
        <section className="bg-slate-900/30 border border-slate-900/80 rounded-2xl p-8 max-w-4xl w-full mt-16 text-left">
          <h3 className="font-semibold text-slate-200 mb-2 text-sm uppercase tracking-wider flex items-center gap-2">
            <Settings className="w-4 h-4 text-blue-500" />
            Uso de Dados & Conexão com Google Ads API
          </h3>
          <p className="text-slate-400 text-xs leading-relaxed mb-0">
            A ClicqLab solicita acesso aos dados de sua conta do Google Ads unicamente para exibir relatórios de desempenho consolidados e gerenciar termos de campanhas. A conexão é segura, criptografada via OAuth 2.0 oficial do Google, e a qualquer momento você pode revogar as permissões concedidas diretamente nas configurações da sua Conta do Google. Nós respeitamos estritamente a política de Uso Limitado de dados do usuário do Google.
          </p>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-900 bg-slate-950/80 py-8 px-6 mt-16">
        <div className="max-w-7xl mx-auto w-full flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <div>
            &copy; 2026 ClicqLab. Todos os direitos reservados.
          </div>
          <div className="flex gap-6">
            <a href="/privacy.html" className="hover:text-slate-300 underline">
              Política de Privacidade
            </a>
            <a href="/terms.html" className="hover:text-slate-300 underline">
              Termos de Serviço
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
