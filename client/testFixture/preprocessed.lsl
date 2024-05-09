//start_unprocessed_text
/*#define DEBUG
#include "debug.lsl"

#define DEBUG_MODE NULL_KEY
#define shout(a) llShout(PUBLIC_CHANNEL, a);

/|/ there is an issue when I try to write the list here
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
        /|/ #warning "djdjdjd"
    }

    touch_start(integer total_number)
    {
        /|/ #error "dsadsadsa"
        #ifdef DEBUG_MODE
        if (llDetectedKey(0) != NULL_KEY) {
        #else
        if (llDetectedKey(0) == llGetOwner()) {
        #endif
            integer random = llFloor(llFrand(4)) + 1;
            switch (random)
            {
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
}*/
//end_unprocessed_text
//nfo_preprocessor_version 0
//program_version Firestorm-Releasex64 6.6.17.70368 - Jeremy Fairelander
//last_compiled 05/08/2024 18:08:56
//mono






//#line 8 "D:\\Program Files\\Firestorm-Releasex64\\New Script"
list myList = ["a", "b"];
list lazy_list_set(list L, integer i, list v)
{
    while (llGetListLength(L) < i)
        L = L + 0;
    return llListReplaceList(L, v, i, i);
}


debug(string text) {
    llOwnerSay(text);
}

default
{
    state_entry()
    {
        debug("oof");
        myList=lazy_list_set(myList,2,["c"]);
        debug(llList2String(myList,2));
        llShout(PUBLIC_CHANNEL, ((string)(NULL_KEY)));;
        //#line 21 "D:\\Program Files\\Firestorm-Releasex64\\New Script"
llOwnerSay("oh no");
        
    }

    touch_start(integer total_number)
    {
        
        if (llDetectedKey(0) != NULL_KEY) {
            integer random = llFloor(llFrand(4)) + 1;
            {if((random) == (1
                ))jump cz9839;
if((random) == (2
                ))jump cZx0aE;
if((random) == (3
                ))jump cgt1HP;
if((random) == (4
                ))jump cPLotj;
jump c87t6L;

                @cz9839;
{
                    debug("1 is the loneliest number");
                    jump c47yfc;
                }
                @cZx0aE;
{
                    debug("2 and you have a friend");
                    jump c47yfc;
                }
                @cgt1HP;
{
                    debug("3's company");
                    jump c47yfc;
                }
                @cPLotj;
{
                    debug("Too many cooks in the kitchen");
                    jump c47yfc;
                }
                @c87t6L;
                {
                    jump c47yfc;
                }
           

@c47yfc;
}
        }
    }
}
