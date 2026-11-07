#include "remote.lsl";

default {
    state_entry()
    {
        integer isTwoEven = isEven(2);
        if (isTwoEven) llOwnerSay("yes");
        else llOwnerSay("no");

        integer isTwoOdd = isOdd(2);
        if (isTwoOdd) llOwnerSay("yes");
        else llOwnerSay("no");
    }
}