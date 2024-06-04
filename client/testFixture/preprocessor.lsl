#define DEBUG
#include "debug.lsl"

#define DEBUG_MODE NULL_KEY
#define shout(a) llShout(PUBLIC_CHANNEL, a);

#define OS(a,b) if (a > 1) {\
  llOwnerSay((string)a);\
} else {\
  llOwnerSay((string)b);\
}

// there is an issue when I try to write the list here
list myList = ["a", "b"];

default
{
    state_entry()
    {
        debug("oof");
        myList[2] = "c";
        debug((string)myList[2]);
        shout(string(DEBUG_MODE));
        #if DEBUG_MODE != NULL_KEY
        llOwnerSay("wow");
        #else
        llOwnerSay("oh no");
        #endif
        #warning "djdjdjd"
    }

    touch_start(integer total_number)
    {
        #error "dsadsadsa"
        while (FALSE) {
            if (TRUE) {
                llSay(PUBLIC_CHANNEL, "oof");
            }
        }
        #ifdef DEBUG_MODE
        if (llDetectedKey(0) != NULL_KEY) {
        #else
        // if (llDetectedKey(0) == llGetOwner()) {
        #endif
            integer random = llFloor(llFrand(4)) + 1;
            switch (random)
            {
                case 0:
                case 1
                {
                    debug("1 is the loneliest number");
                    break;
                }



                case 2
                {
                    debug("2 and you have a friend");
                    break;
                }
                case 3
                {
                    debug("3's company");
                    break;
                }
                // this is a comment
                case 4
                {
                    debug("Too many cooks in the kitchen");
                    break;
                }
                default:
                {
                    break;
                }
            }
        }
        
    }
}