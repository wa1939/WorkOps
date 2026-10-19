"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Loader2, Sparkles, FileText, AlertTriangle, Copy, Check } from "lucide-react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";

export function GenerateReportButton() {
    const router = useRouter();
    const { toast } = useToast();
    const [loading, setLoading] = useState(false);
    const [aiLoading, setAiLoading] = useState(false);
    const [reportData, setReportData] = useState<{ id: string; body: string } | null>(null);
    const [aiSummary, setAiSummary] = useState<string>("");
    const [showDialog, setShowDialog] = useState(false);
    const [showAiWarning, setShowAiWarning] = useState(false);
    const [copied, setCopied] = useState(false);
    const [error, setError] = useState<string>("");

    const handleGenerateBasic = async () => {
        setLoading(true);
        setError("");
        try {
            const res = await fetch("/api/cron/weekly-summary", {
                method: "POST",
            });

            if (res.ok) {
                const data = await res.json();
                setReportData({ id: data.report.id, body: data.report.body });
                setAiSummary("");
                setShowDialog(true);
            } else {
                const errorData = await res.json().catch(() => ({}));
                const message = errorData.error || `فشل في إنشاء التقرير (${res.status})`;
                toast({ variant: "destructive", title: "تعذّر إنشاء التقرير", description: message });
            }
        } catch (error) {
            console.error(error);
            toast({ variant: "destructive", title: "خطأ في الاتصال", description: "حدث خطأ أثناء إنشاء التقرير" });
        } finally {
            setLoading(false);
        }
    };

    const handleEnhanceWithAI = async () => {
        setShowAiWarning(true);
    };

    const confirmAiEnhance = async () => {
        setShowAiWarning(false);
        setAiLoading(true);
        setError("");

        try {
            const res = await fetch("/api/reports/ai-enhance", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ reportId: reportData?.id }),
            });

            if (res.ok) {
                const data = await res.json();
                console.log("AI Response:", data); // Debug log

                if (data.aiSummary) {
                    setAiSummary(data.aiSummary);
                } else {
                    setError("لم يتم إرجاع ملخص من الذكاء الاصطناعي");
                }
            } else {
                const errorData = await res.json();
                console.error("AI Error:", errorData); // Debug log
                setError(errorData.error || "فشل في تحسين التقرير بالذكاء الاصطناعي");
            }
        } catch (error) {
            console.error("AI Enhancement Error:", error);
            setError("حدث خطأ في الاتصال بخدمة الذكاء الاصطناعي");
        } finally {
            setAiLoading(false);
        }
    };

    const handleCopy = () => {
        const textToCopy = aiSummary || reportData?.body || "";
        navigator.clipboard.writeText(textToCopy);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleClose = () => {
        setShowDialog(false);
        setReportData(null);
        setAiSummary("");
        setError("");
        router.refresh();
    };

    return (
        <>
            <Button onClick={handleGenerateBasic} disabled={loading}>
                {loading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                    <FileText className="mr-2 h-4 w-4" />
                )}
                إنشاء التقرير
            </Button>

            {/* Report Dialog */}
            <Dialog open={showDialog} onOpenChange={setShowDialog}>
                <DialogContent className="max-w-5xl max-h-[85vh] overflow-hidden flex flex-col">
                    <DialogHeader>
                        <DialogTitle className="text-xl">التقرير الأسبوعي</DialogTitle>
                        <DialogDescription>
                            يمكنك مراجعة التقرير أو تحسينه باستخدام الذكاء الاصطناعي
                        </DialogDescription>
                    </DialogHeader>

                    {error && (
                        <Alert variant="destructive">
                            <AlertDescription>{error}</AlertDescription>
                        </Alert>
                    )}

                    <div className="space-y-4 overflow-y-auto flex-1 px-1">
                        {/* Basic Report */}
                        <div className="border rounded-lg p-4 bg-card">
                            <div className="flex items-center justify-between mb-3">
                                <h4 className="font-medium flex items-center gap-2">
                                    <FileText className="h-4 w-4" />
                                    التقرير الأساسي
                                </h4>
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={handleCopy}
                                    className="h-8"
                                >
                                    {copied ? (
                                        <>
                                            <Check className="h-3 w-3 mr-1" />
                                            تم النسخ
                                        </>
                                    ) : (
                                        <>
                                            <Copy className="h-3 w-3 mr-1" />
                                            نسخ
                                        </>
                                    )}
                                </Button>
                            </div>
                            <div
                                className="prose prose-sm max-w-none whitespace-pre-wrap text-sm leading-relaxed"
                                dir="rtl"
                                style={{ fontFamily: "system-ui, -apple-system, sans-serif" }}
                            >
                                {reportData?.body}
                            </div>
                        </div>

                        {/* AI Summary */}
                        {aiSummary && (
                            <div className="border-2 rounded-lg p-5 bg-gradient-to-br from-purple-50 to-pink-50 dark:from-purple-950/20 dark:to-pink-950/20 border-purple-300">
                                <div className="flex items-center justify-between mb-3">
                                    <h4 className="font-semibold flex items-center gap-2 text-purple-700 dark:text-purple-300">
                                        <Sparkles className="h-5 w-5" />
                                        ملخص احترافي بالذكاء الاصطناعي
                                    </h4>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => {
                                            navigator.clipboard.writeText(aiSummary);
                                            setCopied(true);
                                            setTimeout(() => setCopied(false), 2000);
                                        }}
                                        className="h-8 border-purple-300"
                                    >
                                        {copied ? (
                                            <>
                                                <Check className="h-3 w-3 mr-1" />
                                                تم النسخ
                                            </>
                                        ) : (
                                            <>
                                                <Copy className="h-3 w-3 mr-1" />
                                                نسخ
                                            </>
                                        )}
                                    </Button>
                                </div>
                                <Textarea
                                    value={aiSummary}
                                    onChange={(e) => setAiSummary(e.target.value)}
                                    className="min-h-[300px] text-sm leading-relaxed border-purple-200 bg-white/80"
                                    dir="rtl"
                                    placeholder="جاري إنشاء الملخص..."
                                />
                                <p className="text-xs text-muted-foreground mt-2" dir="rtl">
                                    💡 يمكنك تعديل النص أعلاه حسب الحاجة
                                </p>
                            </div>
                        )}
                    </div>

                    <DialogFooter className="gap-2 flex-row justify-between">
                        <div className="flex gap-2">
                            {!aiSummary && !aiLoading && (
                                <Button
                                    variant="outline"
                                    onClick={handleEnhanceWithAI}
                                    disabled={aiLoading || !reportData}
                                    className="border-purple-500 text-purple-600 hover:bg-purple-50"
                                >
                                    {aiLoading ? (
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    ) : (
                                        <Sparkles className="mr-2 h-4 w-4" />
                                    )}
                                    تحسين بالذكاء الاصطناعي
                                </Button>
                            )}
                            {aiLoading && (
                                <div className="flex items-center gap-2 text-sm text-purple-600">
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    جاري إنشاء الملخص الذكي...
                                </div>
                            )}
                        </div>
                        <Button onClick={handleClose} variant="secondary">إغلاق</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* AI Cost Warning Dialog */}
            <Dialog open={showAiWarning} onOpenChange={setShowAiWarning}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-yellow-600">
                            <AlertTriangle className="h-5 w-5" />
                            تحذير: تكلفة مالية
                        </DialogTitle>
                        <DialogDescription className="text-base space-y-2" dir="rtl">
                            <p className="font-medium">
                                استخدام الذكاء الاصطناعي يكلف أموالاً.
                            </p>
                            <p className="text-sm">
                                كل طلب يُحتسب من رصيد Gemini API الخاص بك.
                            </p>
                            <p className="text-sm text-muted-foreground">
                                سيتم إنشاء ملخص احترافي بنقاط مختصرة باللغة العربية.
                            </p>
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowAiWarning(false)}>
                            إلغاء
                        </Button>
                        <Button
                            onClick={confirmAiEnhance}
                            className="bg-purple-600 hover:bg-purple-700"
                            disabled={aiLoading}
                        >
                            <Sparkles className="mr-2 h-4 w-4" />
                            نعم، استخدم الذكاء الاصطناعي
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
