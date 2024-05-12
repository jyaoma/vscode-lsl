#define DEBUG
#define DEBUG_MODE NULL_KEY
#define DEBUG_STR "oof foo"
#define shout(a) llShout(PUBLIC_CHANNEL, a);
#define concat(a, b) return a##b;
#define OS(a,b) if (a > 1) {\
  llOwnerSay((string)a);\
} else {\
  llOwnerSay((string)b);\
}

default {
    state_entry()
    {
        shout(DEBUG_STR);
        OS(concat("wowowow", "awawawa"));
    }
}