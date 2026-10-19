export interface DailyQuote {
    text_ar: string;
    text_en: string;
    author: string;
}

const quotes: DailyQuote[] = [
    { text_ar: "من جد وجد ومن زرع حصد", text_en: "Whoever strives shall find, and whoever plants shall harvest.", author: "Arabic Proverb" },
    { text_ar: "العلم نور والجهل ظلام", text_en: "Knowledge is light, ignorance is darkness.", author: "Arabic Proverb" },
    { text_ar: "الصبر مفتاح الفرج", text_en: "Patience is the key to relief.", author: "Arabic Proverb" },
    { text_ar: "اطلبوا العلم من المهد إلى اللحد", text_en: "Seek knowledge from the cradle to the grave.", author: "Prophet Muhammad (PBUH)" },
    { text_ar: "إن الله يحب إذا عمل أحدكم عملاً أن يتقنه", text_en: "God loves when one of you does something to do it with excellence.", author: "Prophet Muhammad (PBUH)" },
    { text_ar: "التخطيط الجيد نصف النجاح", text_en: "Good planning is half the success.", author: "Arabic Wisdom" },
    { text_ar: "لا تؤجل عمل اليوم إلى الغد", text_en: "Do not postpone today's work to tomorrow.", author: "Arabic Proverb" },
    { text_ar: "العمل الجماعي يصنع المعجزات", text_en: "Teamwork creates miracles.", author: "Leadership Wisdom" },
    { text_ar: "النجاح ليس نهائياً والفشل ليس قاتلاً", text_en: "Success is not final, failure is not fatal — it is the courage to continue that counts.", author: "Winston Churchill" },
    { text_ar: "كل إنجاز عظيم كان في البداية حلماً", text_en: "Every great achievement was once a dream.", author: "Motivational" },
    { text_ar: "القيادة هي العمل وليس المنصب", text_en: "Leadership is action, not position.", author: "Donald McGannon" },
    { text_ar: "أفضل طريقة للتنبؤ بالمستقبل هي صنعه", text_en: "The best way to predict the future is to create it.", author: "Peter Drucker" },
    { text_ar: "الجودة ليست عملاً بل عادة", text_en: "Quality is not an act, it is a habit.", author: "Aristotle" },
    { text_ar: "لا تخف من التغيير بل من البقاء كما أنت", text_en: "Do not fear change, fear staying the same.", author: "Leadership Wisdom" },
    { text_ar: "وحدنا يمكننا فعل القليل، معاً يمكننا فعل الكثير", text_en: "Alone we can do so little, together we can do so much.", author: "Helen Keller" },
    { text_ar: "التميز ليس مهارة بل موقف", text_en: "Excellence is not a skill, it is an attitude.", author: "Ralph Marston" },
    { text_ar: "كن التغيير الذي تريد أن تراه في العالم", text_en: "Be the change you wish to see in the world.", author: "Mahatma Gandhi" },
    { text_ar: "النجاح يأتي لمن يتحرك ولا ينتظر", text_en: "Success comes to those who act, not those who wait.", author: "Arabic Wisdom" },
    { text_ar: "الابتكار يميز بين القائد والتابع", text_en: "Innovation distinguishes between a leader and a follower.", author: "Steve Jobs" },
    { text_ar: "اعمل بصمت ودع نجاحك يتحدث", text_en: "Work in silence, let your success make the noise.", author: "Motivational" },
    { text_ar: "الفرص لا تأتي بل تُصنع", text_en: "Opportunities are not given, they are created.", author: "Chris Grosser" },
    { text_ar: "الطريقة الوحيدة لعمل عظيم هي أن تحب ما تعمل", text_en: "The only way to do great work is to love what you do.", author: "Steve Jobs" },
    { text_ar: "ليس المهم أن تبدأ بل أن تستمر", text_en: "It's not about starting, it's about persisting.", author: "Arabic Wisdom" },
    { text_ar: "أعظم مجد ليس في عدم السقوط بل في النهوض كل مرة نسقط فيها", text_en: "The greatest glory is not in never falling, but in rising every time we fall.", author: "Confucius" },
    { text_ar: "التعاون سر النجاح", text_en: "Collaboration is the secret to success.", author: "Arabic Proverb" },
    { text_ar: "كل يوم هو فرصة جديدة", text_en: "Every day is a new opportunity.", author: "Motivational" },
    { text_ar: "المثابرة تغلب الموهبة عندما تنام الموهبة", text_en: "Perseverance beats talent when talent doesn't work hard.", author: "Tim Notke" },
    { text_ar: "ركز على الحل وليس على المشكلة", text_en: "Focus on the solution, not the problem.", author: "Leadership Wisdom" },
    { text_ar: "العقبات هي ما تراه عندما تحيد نظرك عن الهدف", text_en: "Obstacles are what you see when you take your eyes off the goal.", author: "Henry Ford" },
    { text_ar: "النظام أساس النجاح", text_en: "Organization is the foundation of success.", author: "Arabic Wisdom" },
    { text_ar: "اجعل كل يوم تحفة فنية", text_en: "Make each day your masterpiece.", author: "John Wooden" },
    { text_ar: "الاتصال الفعال هو جسر بين الفوضى والوضوح", text_en: "Effective communication bridges confusion and clarity.", author: "Nat Turner" },
    { text_ar: "ابدأ من حيث أنت، استخدم ما لديك، افعل ما تستطيع", text_en: "Start where you are, use what you have, do what you can.", author: "Arthur Ashe" },
    { text_ar: "الاستثمار في المعرفة يحقق أفضل عائد", text_en: "An investment in knowledge pays the best interest.", author: "Benjamin Franklin" },
    { text_ar: "لا تحسب المشاكل بل احسب النعم", text_en: "Don't count the problems, count the blessings.", author: "Arabic Wisdom" },
    { text_ar: "التقدم أهم من الكمال", text_en: "Progress is more important than perfection.", author: "Motivational" },
    { text_ar: "القائد الحقيقي يخدم فريقه", text_en: "A true leader serves their team.", author: "Leadership Wisdom" },
    { text_ar: "إذا لم تستطع أن تطير فاركض", text_en: "If you can't fly, then run. If you can't run, then walk. But keep moving.", author: "Martin Luther King Jr." },
    { text_ar: "النجاح مجموع جهود صغيرة تتكرر يوماً بعد يوم", text_en: "Success is the sum of small efforts repeated day in and day out.", author: "Robert Collier" },
    { text_ar: "اصنع من الصعوبات سلالم للنجاح", text_en: "Turn difficulties into stepping stones for success.", author: "Arabic Wisdom" },
];

export function getTodayQuote(): DailyQuote {
    const now = new Date();
    const start = new Date(now.getFullYear(), 0, 0);
    const diff = now.getTime() - start.getTime();
    const dayOfYear = Math.floor(diff / (1000 * 60 * 60 * 24));
    return quotes[dayOfYear % quotes.length];
}
